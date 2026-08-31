-- Кроны прямого контура запуска рекламы (docs/AD-LAUNCH-DIRECT-META.md).
--
-- Крон здесь не «двигатель», а страховка: ad-launch-enqueue дёргает воркер
-- сразу после создания задания (fire-and-forget), поэтому нажатие «Запустить»
-- не ждёт следующей минуты. Крон подбирает то, что упало, зависло в processing
-- или ждёт готовности видео у Meta.
--
-- Заголовок авторизации — x-automation-key = automation_settings.cron_secret,
-- как в binotel-import-calls и capi-outbox-worker.

-- 1. Двигатель очереди + ретраи. Раз в минуту.
SELECT cron.unschedule('ad-launch-worker-1min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ad-launch-worker-1min');

SELECT cron.schedule(
  'ad-launch-worker-1min',
  '* * * * *',
  $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ad-launch-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'cron', 'batch_size', 5)
  );
  $CRON$
);

-- 2. Материализация авто-запусков. Раз в 5 минут — точности «час запуска
--    в таймзоне кабинета» этого достаточно.
SELECT cron.unschedule('ad-launch-scheduler-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ad-launch-scheduler-5min');

SELECT cron.schedule(
  'ad-launch-scheduler-5min',
  '*/5 * * * *',
  $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ad-launch-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'cron')
  );
  $CRON$
);

-- 3. Здоровье токенов Meta. Раз в сутки в 06:00 UTC.
--    Без этого протухший токен ловится только по факту упавшего запуска
--    (Graph code 190), и обычно молча.
SELECT cron.unschedule('meta-token-health-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-token-health-daily');

SELECT cron.schedule(
  'meta-token-health-daily',
  '0 6 * * *',
  $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/meta-token-health',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{}'::jsonb
  );
  $CRON$
);
