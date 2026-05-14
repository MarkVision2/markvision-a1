import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-automation-key',
};

const TEMPLATES: Record<string, string> = {
  followup_24h: '{name}, добрый день! Напомню о себе по {service}. Подскажите, актуально ли ещё? Если есть вопросы — отвечу.',
  revival_7d: '{name}, здравствуйте! Прошла неделя — возможно, ситуация изменилась? Готов предложить особые условия по {service}, если ещё интересно.',
  followup_2h_msg: '{name}, ещё раз здравствуйте! Уточните, пожалуйста, удобно ли созвониться по {service}?',
};

function render(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString() || '—');
}

function bucketFloor(d: Date, hours: number): string {
  const ms = hours * 3600 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms).toISOString();
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
      .select('id, name, service, phone, assigned_to, last_outbound_at, last_inbound_at, channel, pipeline_stages!inner(key)')
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
      await supabase.from('communications').insert({
        lead_id: l.id,
        type: 'message',
        channel: l.channel ?? 'whatsapp',
        direction: 'out',
        content,
        is_auto: true,
        is_draft: false,
        template_key: settings.auto_msg_24h_template_key,
        status: 'sent',
      });
      await supabase.from('events').insert({
        lead_id: l.id, event_type: 'automation_24h_sent',
        payload: { template: settings.auto_msg_24h_template_key, preview: content.slice(0, 120) },
      });
      stats.auto_msg_24h++;
    }
  }

  // ---------------- Rule 3: revival 7d -----------------
  if (settings.revival_7d_enabled) {
    const threshold = new Date(now.getTime() - settings.revival_7d_days * 86400_000).toISOString();
    const bucket = bucketFloor(now, 24 * 30); // не чаще раза в 30 дней
    const tplText = TEMPLATES[settings.revival_7d_template_key] ?? TEMPLATES.revival_7d;

    const { data: leads } = await supabase
      .from('leads')
      .select('id, name, service, phone, channel, assigned_to, rejected_at, reject_reason, pipeline_stages!inner(key)')
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
      await supabase.from('communications').insert({
        lead_id: l.id,
        type: 'message',
        channel: l.channel ?? 'whatsapp',
        direction: 'out',
        content,
        is_auto: true,
        is_draft: false,
        template_key: settings.revival_7d_template_key,
        status: 'sent',
      });
      await supabase.from('events').insert({
        lead_id: l.id, event_type: 'automation_revival_7d',
        payload: { template: settings.revival_7d_template_key, preview: content.slice(0, 120) },
      });
      stats.revival_7d++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ...stats, ran_at: now.toISOString() }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});