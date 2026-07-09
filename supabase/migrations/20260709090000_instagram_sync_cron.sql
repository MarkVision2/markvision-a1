-- instagram-sync никогда не запускался автоматически — только вручную по кнопке
-- "Обновить" в аналитике. Из-за этого контент, опубликованный прямо в Instagram
-- (не через автопостинг), и его охваты/просмотры не появлялись в CRM, пока
-- кто-то не открывал панель и не нажимал обновление вручную. Добавляем
-- периодический cron, как у остальных Meta-синков (meta-daily-sync и т.д.).
select cron.schedule(
  'instagram-sync-periodic',
  '0 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/instagram-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body := jsonb_build_object('all', true),
    timeout_milliseconds := 120000
  );
  $$
);
