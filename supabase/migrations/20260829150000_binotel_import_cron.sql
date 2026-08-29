-- Синхронизация звонков Binotel по расписанию.
-- Пока webhook-и не настроены на стороне АТС (в кабинете Binotel их ставит
-- поддержка), звонки подтягиваются опросом API: раз в 15 минут по всем проектам
-- с включённым подключением. Когда webhook заработает, крон станет страховкой —
-- дубли отсекаются по communications.external_id.

SELECT cron.unschedule('binotel-import-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'binotel-import-15min');

SELECT cron.schedule(
  'binotel-import-15min',
  '*/15 * * * *',
  $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/binotel-import-calls',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'cron', 'days', 1)
  );
  $CRON$
);
