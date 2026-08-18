import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from '../_lib/green_api_url.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-automation-key',
};

const TEMPLATES: Record<string, string> = {
  followup_24h: '{name}, добрый день! Напомню о себе по {service}. Подскажите, актуально ли ещё? Если есть вопросы — отвечу.',
  revival_7d: '{name}, здравствуйте! Прошла неделя — возможно, ситуация изменилась? Готов предложить особые условия по {service}, если ещё интересно.',
  followup_2h_msg: '{name}, ещё раз здравствуйте! Уточните, пожалуйста, удобно ли созвониться по {service}?',
};

const ENV_ID = Deno.env.get('GREENAPI_ID_INSTANCE') ?? '';
const ENV_TOKEN = Deno.env.get('GREENAPI_API_TOKEN') ?? '';
const ENV_URL = Deno.env.get('GREENAPI_API_URL') ?? DEFAULT_GREEN_API_BASE_URL;

type GreenCreds = {
  idInstance: string;
  apiToken: string;
  baseUrl: string;
};

type AutomationLead = {
  id: string;
  name: string;
  service: string | null;
  phone?: string | null;
  project_id?: string | null;
  assigned_to?: string | null;
  channel?: string | null;
};

function render(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString() || '—');
}

function bucketFloor(d: Date, hours: number): string {
  const ms = hours * 3600 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms).toISOString();
}

function digits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\D/g, '');
}

async function resolveGreenCreds(supabase: ReturnType<typeof createClient>, projectId: string | null | undefined): Promise<GreenCreds | null> {
  if (projectId) {
    const { data: row } = await supabase
      .from('whatsapp_config')
      .select('id_instance, api_token, api_url')
      .eq('project_id', projectId)
      .maybeSingle();
    if (row?.id_instance) {
      const apiToken = String(row.api_token ?? '').trim() || (row.id_instance === ENV_ID ? ENV_TOKEN : '');
      if (apiToken) {
        return {
          idInstance: String(row.id_instance),
          apiToken,
          baseUrl: validateGreenApiBaseUrl(String(row.api_url ?? '') || ENV_URL),
        };
      }
    }
  }
  if (ENV_ID && ENV_TOKEN) {
    return {
      idInstance: ENV_ID,
      apiToken: ENV_TOKEN,
      baseUrl: validateGreenApiBaseUrl(ENV_URL),
    };
  }
  return null;
}

async function callGreen(creds: GreenCreds, path: string, body: Record<string, unknown>) {
  const url = `${creds.baseUrl}/waInstance${creds.idInstance}/${path}/${creds.apiToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { ok: res.ok, status: res.status, data };
}

async function sendViaWaWeb(supabase: ReturnType<typeof createClient>, lead: AutomationLead, content: string): Promise<boolean> {
  if (!lead.project_id) return false;
  const phone = digits(lead.phone);
  if (phone.length < 8) return false;
  const { data: session } = await supabase
    .from('whatsapp_web_sessions')
    .select('status')
    .eq('project_id', lead.project_id)
    .maybeSingle();
  if (session?.status !== 'connected') return false;
  const { error } = await supabase
    .from('whatsapp_web_commands')
    .insert({
      project_id: lead.project_id,
      action: 'send',
      payload: { phone, message: content, lead_id: lead.id },
      status: 'pending',
    });
  return !error;
}

async function sendViaGreenApi(
  supabase: ReturnType<typeof createClient>,
  lead: AutomationLead,
  content: string,
): Promise<{ ok: boolean; externalId: string | null; error?: string }> {
  const phone = digits(lead.phone);
  if (phone.length < 8 || phone.length > 15) return { ok: false, externalId: null, error: 'invalid_phone' };
  const creds = await resolveGreenCreds(supabase, lead.project_id);
  if (!creds) return { ok: false, externalId: null, error: 'greenapi_not_configured' };

  let chatId = `${phone}@c.us`;
  try {
    const checked = await callGreen(creds, 'checkWhatsapp', { phoneNumber: Number(phone) });
    const data = checked.data as { existsWhatsapp?: boolean; chatId?: string } | null;
    if (data?.existsWhatsapp === false) return { ok: false, externalId: null, error: 'no_whatsapp' };
    if (data?.chatId && String(data.chatId).includes('@')) chatId = String(data.chatId);
  } catch {
    // fallback @c.us
  }

  const sent = await callGreen(creds, 'sendMessage', { chatId, message: content });
  const idMessage = (sent.data as { idMessage?: string } | null)?.idMessage ?? null;
  return {
    ok: sent.ok && !!idMessage,
    externalId: idMessage,
    error: sent.ok ? undefined : `greenapi_${sent.status}`,
  };
}

async function sendAutomationMessage(
  supabase: ReturnType<typeof createClient>,
  lead: AutomationLead,
  content: string,
  templateKey: string,
): Promise<{ ok: boolean; via: 'wa_web' | 'greenapi' | 'none'; error?: string }> {
  if (await sendViaWaWeb(supabase, lead, content)) {
    return { ok: true, via: 'wa_web' };
  }

  const green = await sendViaGreenApi(supabase, lead, content);
  await supabase.from('communications').insert({
    lead_id: lead.id,
    type: 'message',
    channel: lead.channel ?? 'whatsapp',
    direction: 'out',
    content,
    is_auto: true,
    is_draft: false,
    template_key: templateKey,
    status: green.ok ? 'sent' : 'failed',
    external_id: green.externalId,
  });
  return green.ok
    ? { ok: true, via: 'greenapi' }
    : { ok: false, via: 'none', error: green.error ?? 'send_failed' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Загружаем настройки + секрет (service role видит cron_secret)
  const { data: settings, error: setErr } = await supabase
    .from('automation_settings').select('*').eq('id', true).single();
  if (setErr || !settings) {
    return new Response(JSON.stringify({ error: 'settings_missing', detail: setErr?.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Authorize: either valid cron secret (cron) OR signed-in admin (manual run).
  const provided = req.headers.get('x-automation-key');
  const cronOk = !!provided && !!settings.cron_secret && provided === settings.cron_secret;
  let adminOk = false;
  if (!cronOk) {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (jwt) {
      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user?.id) {
        const { data: roleRow } = await supabase
          .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
        adminOk = !!roleRow;
      }
    }
  }
  if (!cronOk && !adminOk) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  const stats = { followup_2h: 0, auto_msg_24h: 0, revival_7d: 0, errors: [] as string[] };

  // ---------------- Rule 1: followup 2h -----------------
  if (settings.followup_2h_enabled) {
    const threshold = new Date(now.getTime() - settings.followup_2h_minutes * 60_000).toISOString();
    const bucket = bucketFloor(now, 12); // одно срабатывание на лид раз в 12ч
    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, service, assigned_to, stage_id, last_outbound_at, last_inbound_at, pipeline_stages!inner(key)')
      .lte('last_outbound_at', threshold)
      .or(`last_inbound_at.is.null,last_inbound_at.lt.last_outbound_at`)
      .not('pipeline_stages.key', 'in', '(paid,rejected)')
      .limit(200);

    for (const l of leads ?? []) {
      const { error: insErr } = await supabase.from('automation_runs').insert({
        lead_id: l.id, rule: 'followup_2h', bucket_at: bucket, payload: { stage: (l as any).pipeline_stages?.key },
      });
      if (insErr) continue; // дубликат окна — пропускаем

      // Создаём задачу
      await supabase.from('tasks').insert({
        lead_id: l.id,
        type: 'followup',
        title: `Дожать клиента: ${l.name}`,
        due_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
        assigned_to: l.assigned_to,
        source: 'automation',
      });
      await supabase.from('events').insert({
        lead_id: l.id, event_type: 'automation_followup_2h',
        payload: { rule: 'followup_2h', minutes: settings.followup_2h_minutes },
      });
      stats.followup_2h++;
    }
  }

  // ---------------- Rule 2: auto-message 24h -----------------
  if (settings.auto_msg_24h_enabled) {
    const threshold = new Date(now.getTime() - settings.auto_msg_24h_hours * 3600_000).toISOString();
    const bucket = bucketFloor(now, 24 * 7); // не чаще раза в неделю
    const tplText = TEMPLATES[settings.auto_msg_24h_template_key] ?? TEMPLATES.followup_24h;

    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, service, phone, project_id, assigned_to, last_outbound_at, last_inbound_at, channel, pipeline_stages!inner(key)')
      .lte('last_outbound_at', threshold)
      .or(`last_inbound_at.is.null,last_inbound_at.lt.last_outbound_at`)
      .not('pipeline_stages.key', 'in', '(paid,rejected)')
      .limit(200);

    for (const l of leads ?? []) {
      const { error: insErr } = await supabase.from('automation_runs').insert({
        lead_id: l.id, rule: 'auto_msg_24h', bucket_at: bucket,
      });
      if (insErr) continue;

      const content = render(tplText, { name: l.name, service: l.service ?? 'услуге' });
      const sent = await sendAutomationMessage(supabase, l as AutomationLead, content, settings.auto_msg_24h_template_key);
      if (!sent.ok) stats.errors.push(`auto_msg_24h:${l.id}:${sent.error ?? 'send_failed'}`);
      await supabase.from('events').insert({
        lead_id: l.id, event_type: 'automation_24h_sent',
        payload: { template: settings.auto_msg_24h_template_key, preview: content.slice(0, 120), delivery: sent },
      });
      if (sent.ok) stats.auto_msg_24h++;
    }
  }

  // ---------------- Rule 3: revival 7d -----------------
  if (settings.revival_7d_enabled) {
    const threshold = new Date(now.getTime() - settings.revival_7d_days * 86400_000).toISOString();
    const bucket = bucketFloor(now, 24 * 30); // не чаще раза в 30 дней
    const tplText = TEMPLATES[settings.revival_7d_template_key] ?? TEMPLATES.revival_7d;

    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, service, phone, project_id, channel, assigned_to, rejected_at, reject_reason, pipeline_stages!inner(key)')
      .eq('pipeline_stages.key', 'rejected')
      .lte('rejected_at', threshold)
      .not('reject_reason', 'in', '(competitor,not_target)')
      .limit(200);

    for (const l of leads ?? []) {
      const { error: insErr } = await supabase.from('automation_runs').insert({
        lead_id: l.id, rule: 'revival_7d', bucket_at: bucket, payload: { reason: l.reject_reason },
      });
      if (insErr) continue;

      await supabase.from('tasks').insert({
        lead_id: l.id,
        type: 'revival',
        title: `Вернуть лид: ${l.name}`,
        due_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
        assigned_to: l.assigned_to,
        source: 'automation',
      });

      const content = render(tplText, { name: l.name, service: l.service ?? 'услуге' });
      const sent = await sendAutomationMessage(supabase, l as AutomationLead, content, settings.revival_7d_template_key);
      if (!sent.ok) stats.errors.push(`revival_7d:${l.id}:${sent.error ?? 'send_failed'}`);
      await supabase.from('events').insert({
        lead_id: l.id, event_type: 'automation_revival_7d',
        payload: { template: settings.revival_7d_template_key, preview: content.slice(0, 120), delivery: sent },
      });
      if (sent.ok) stats.revival_7d++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ...stats, ran_at: now.toISOString() }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
