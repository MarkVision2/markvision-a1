-- ============================================================================
-- Самовосстановление авто-синка Meta (расходы/лиды).
--
-- Симптом, который чинит этот файл: cron meta-daily-sync-daily перестал
-- автоматически тянуть данные с Meta, пользователь вынужден жать кнопку
-- ручного синка. Причины бывают три, и эта миграция закрывает все три:
--
--   1) Cron в БД остался со старым заголовком x-cron-key (или ссылается на
--      устаревшее значение cron_secret), а edge-функция ждёт x-automation-key.
--      → Пересоздаём cron-job с актуальным заголовком + значением из
--        automation_settings.cron_secret.
--
--   2) automation_settings.cron_secret пустое/NULL (мог обнулиться, могла
--      не сработать seed-вставка). Тогда любая авторизация cron'а будет
--      падать с 401.
--      → Идемпотентно убеждаемся, что row есть и cron_secret не пуст.
--        Если пуст — генерируем 64-символьный hex-секрет.
--
--   3) Невозможно из UI быстро понять, в чём дело. Цикл диагностики долгий.
--      → Добавляем две RPC: meta_sync_diagnostics() (что с cron'ом, последние
--        прогоны, есть ли секрет) и meta_sync_run_now() (триггерит синк
--        прямо сейчас, без cron'а). Обе admin-only.
--
-- Также в конце миграции триггерим разовый прогон через pg_net — чтобы
-- сразу после применения миграции данные за вчера/сегодня подтянулись и
-- пользователь увидел эффект, не дожидаясь следующего 00:30 UTC.
-- ============================================================================

-- 1) Гарантируем automation_settings row + непустой cron_secret.
INSERT INTO public.automation_settings (id, cron_secret)
VALUES (true, encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

UPDATE public.automation_settings
SET cron_secret = encode(gen_random_bytes(32), 'hex'),
    updated_at = now()
WHERE id = true
  AND (cron_secret IS NULL OR length(btrim(cron_secret)) = 0);

-- 2) Пересоздаём cron-job. Делаем через DO-block, потому что cron.unschedule
--    кидает ошибку, если job отсутствует, а нам нужна идемпотентность.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-daily-sync-daily') THEN
    PERFORM cron.unschedule('meta-daily-sync-daily');
  END IF;
END$$;

SELECT cron.schedule(
  'meta-daily-sync-daily',
  '30 0 * * *',  -- 00:30 UTC = 05:30 Almaty
  $$
  SELECT net.http_post(
    url     := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/meta-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- 3) RPC: диагностика. Возвращает JSON-снимок состояния авто-синка, чтобы
--    из UI/Studio можно было одним вызовом увидеть, что не так.
CREATE OR REPLACE FUNCTION public.meta_sync_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_jobid bigint;
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'meta-daily-sync-daily';

  v_result := jsonb_build_object(
    'cron_secret_present', (
      SELECT cron_secret IS NOT NULL AND length(btrim(cron_secret)) > 0
        FROM public.automation_settings WHERE id = true
    ),
    'cron_job', (
      SELECT jsonb_build_object(
        'jobid', jobid,
        'jobname', jobname,
        'schedule', schedule,
        'active', active,
        'command_preview', substr(command, 1, 400)
      )
      FROM cron.job WHERE jobname = 'meta-daily-sync-daily'
    ),
    'last_cron_runs', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY start_time DESC) FROM (
        SELECT start_time, end_time, status, return_message
        FROM cron.job_run_details
        WHERE jobid = v_jobid
        ORDER BY start_time DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'last_sync_runs', COALESCE((
      SELECT jsonb_agg(row_to_json(r) ORDER BY created_at DESC) FROM (
        SELECT created_at, triggered_by, ok, since, until, days,
               leads, spend, error, error_code, external_id
        FROM public.ad_sync_runs
        WHERE provider = 'meta'
        ORDER BY created_at DESC
        LIMIT 20
      ) r
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_sync_diagnostics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meta_sync_diagnostics() TO authenticated;

-- 4) RPC: ручной триггер синка (без cron'а, без ожидания) для админ-UI.
--    Возвращает request_id из pg_net.
CREATE OR REPLACE FUNCTION public.meta_sync_run_now(
  p_since date DEFAULT NULL,
  p_until date DEFAULT NULL,
  p_cabinet_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id bigint;
  v_body jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_body := '{}'::jsonb;
  IF p_since IS NOT NULL AND p_until IS NOT NULL THEN
    v_body := v_body || jsonb_build_object(
      'since', to_char(p_since, 'YYYY-MM-DD'),
      'until', to_char(p_until, 'YYYY-MM-DD')
    );
  END IF;
  IF p_cabinet_id IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('cabinet_id', p_cabinet_id::text);
  END IF;

  SELECT net.http_post(
    url := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/meta-daily-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body := v_body,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.meta_sync_run_now(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meta_sync_run_now(date, date, uuid) TO authenticated;

-- 5) Триггерим разовый прогон сразу после миграции — чтобы свежие данные
--    подтянулись немедленно, а не на следующее срабатывание cron'а.
--    Best-effort: если pg_net по какой-то причине упадёт, миграцию не валим.
DO $$
DECLARE
  v_secret text;
BEGIN
  SELECT cron_secret INTO v_secret FROM public.automation_settings WHERE id = true;
  IF v_secret IS NULL OR length(btrim(v_secret)) = 0 THEN
    RAISE NOTICE 'meta-daily-sync: cron_secret пустой даже после авто-генерации, пропускаю немедленный прогон';
  ELSE
    BEGIN
      PERFORM net.http_post(
        url := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/meta-daily-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-automation-key', v_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
      RAISE NOTICE 'meta-daily-sync: немедленный прогон поставлен в очередь pg_net';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'meta-daily-sync: немедленный прогон не отправлен: %', SQLERRM;
    END;
  END IF;
END$$;
