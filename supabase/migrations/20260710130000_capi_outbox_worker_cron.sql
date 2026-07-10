-- ============================================================
-- Cron для capi-outbox-worker — делаем очередь ЕДИНСТВЕННЫМ каналом CAPI.
--
-- Проблема: очередь capi_outbox наполнялась триггером on_lead_stage_change_capi,
-- но воркер (capi-outbox-worker) нигде не запускался по расписанию. В итоге:
--   - события копились в статусе 'pending' и никогда не уходили в Meta;
--   - реально в Meta слал только мгновенный fire-and-forget вызов crm-stage-capi
--     из фронта (useCrmStore.moveLead) — с НЕдетерминированным event_id.
-- Если бы кто-то включил воркер, получился бы двойной счёт конверсий
-- (разные event_id → Meta не дедупит).
--
-- Решение: фронт больше не шлёт напрямую (см. правку moveLead), а этот cron
-- раз в минуту прокачивает очередь. Один канал → один event_id (<lead_id>-<event>)
-- → идемпотентность + ретраи + корректный подсчёт в Meta.
--
-- Auth: заголовок x-automation-key = automation_settings.cron_secret
-- (тот же паттерн, что meta-daily-sync и crm-automations; воркер обновлён параллельно).
-- ============================================================

SELECT cron.unschedule('capi-outbox-worker-minutely')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'capi-outbox-worker-minutely');

SELECT cron.schedule(
  'capi-outbox-worker-minutely',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/capi-outbox-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('batch_size', 100)
  );
  $$
);
