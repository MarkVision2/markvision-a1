import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIPUNI_BASE = 'https://sipuni.com/api/callback/call_external';

// sha1(user + sipnumber + phone + anonymous + token)
async function sha1Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normPhone(s: string): string {
  return (s ?? '').replace(/[^\d+]/g, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  // 1. Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimErr } = await userClient.auth.getClaims(authHeader.replace('Bearer ', ''));
  if (claimErr || !claims?.claims?.sub) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const userId = claims.claims.sub;

  // 2. Validate body
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const phone = normPhone(String(body?.phone ?? ''));
  const leadId = typeof body?.leadId === 'string' && body.leadId.length > 0 ? body.leadId : null;
  if (phone.length < 4) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_phone' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 3. Read settings & profile via service role
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: settings, error: setErr } = await admin
    .from('automation_settings')
    .select('telephony_provider, sipuni_enabled, sipuni_user, sipuni_token, sipuni_operator')
    .eq('id', true).single();
  if (setErr || !settings) {
    return new Response(JSON.stringify({ ok: false, error: 'settings_missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const mode = typeof body?.mode === 'string' ? body.mode : 'call';
  if (!settings.sipuni_enabled) {
    return new Response(JSON.stringify({ ok: false, error: 'sipuni_disabled' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (mode === 'call' && settings.telephony_provider !== 'sipuni') {
    return new Response(JSON.stringify({ ok: false, error: 'sipuni_disabled', provider: settings.telephony_provider }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!settings.sipuni_user || !settings.sipuni_token) {
    return new Response(JSON.stringify({ ok: false, error: 'sipuni_not_configured' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: profile } = await admin.from('profiles').select('sip_extension').eq('id', userId).single();
  const operator = (profile?.sip_extension && profile.sip_extension.trim()) || settings.sipuni_operator;
  if (!operator) {
    return new Response(JSON.stringify({ ok: false, error: 'operator_missing', hint: 'set sip_extension in profile or default sipuni_operator' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Test mode: only verify config + signature without actually placing a call.
  if (mode === 'test') {
    // Require admin
    const { data: roleRow } = await admin.from('user_roles')
      .select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ ok: false, error: 'admin_only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      ok: true, mode: 'test', user: settings.sipuni_user, operator,
      tokenSet: true, provider: settings.telephony_provider, enabled: settings.sipuni_enabled,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // 4. Sipuni call_external
  const anonymous = '0';
  const sig = await sha1Hex(`${anonymous}+${phone}+${settings.sipuni_user}+${operator}+${settings.sipuni_token}`);

  const params = new URLSearchParams({
    user: settings.sipuni_user,
    sipnumber: operator,
    phone,
    anonymous,
    hash: sig,
  });

  let sipuniOk = false;
  let sipuniBody = '';
  try {
    const res = await fetch(`${SIPUNI_BASE}?${params.toString()}`, { method: 'POST' });
    sipuniBody = await res.text();
    sipuniOk = res.ok && !sipuniBody.toLowerCase().includes('error');
  } catch (e) {
    sipuniBody = e instanceof Error ? e.message : String(e);
  }

  // 5. Log event
  if (leadId) {
    await admin.from('events').insert({
      lead_id: leadId,
      event_type: 'call_initiated',
      actor_id: userId,
      payload: { provider: 'sipuni', operator, ok: sipuniOk, response: sipuniBody.slice(0, 200) },
    });
  }

  if (!sipuniOk) {
    return new Response(JSON.stringify({
      ok: false, error: 'sipuni_failed', detail: sipuniBody.slice(0, 200), fallbackProvider: 'tel',
    }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true, provider: 'sipuni', operator }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});