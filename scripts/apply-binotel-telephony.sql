-- Binotel: все миграции одним файлом для ручного применения в SQL Editor.
-- Нужен, пока GitHub Actions не может выполнить db push (нет SUPABASE_DB_PASSWORD).
-- Идемпотентно: повторный запуск безопасен. Порядок важен — выполнять целиком.

-- ============================================================
-- 20260829120000_binotel_telephony.sql
-- ============================================================

-- Binotel (украинская виртуальная АТС) как ещё один провайдер телефонии.
-- Архитектура повторяет Sipuni: секреты живут в automation_settings и читаются
-- только сервером (edge functions), фронт видит лишь *_present-флаг.

-- 1. Настройки Binotel в singleton-таблице automation_settings
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS binotel_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS binotel_key text,
  ADD COLUMN IF NOT EXISTS binotel_secret text,
  ADD COLUMN IF NOT EXISTS binotel_operator text,      -- внутренний номер по умолчанию (например 901)
  ADD COLUMN IF NOT EXISTS binotel_pbx_number text,    -- внешний номер, через который звоним
  ADD COLUMN IF NOT EXISTS binotel_crm_base_url text;  -- база для ссылки в карточку лида (apiCallSettings)

-- Индикатор «ключи заданы» без выдачи самих ключей на фронт.
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS binotel_credentials_present boolean
    GENERATED ALWAYS AS (
      binotel_key IS NOT NULL AND length(binotel_key) > 0
      AND binotel_secret IS NOT NULL AND length(binotel_secret) > 0
    ) STORED;

-- 2. telephony_provider теперь принимает 'binotel'
ALTER TABLE public.automation_settings DROP CONSTRAINT IF EXISTS telephony_provider_chk;
ALTER TABLE public.automation_settings
  ADD CONSTRAINT telephony_provider_chk
  CHECK (telephony_provider IN ('tel','sip','sipuni','binotel'));

-- 3. Гранты: безопасные колонки — authenticated, ключи — никогда.
GRANT SELECT (binotel_enabled, binotel_operator, binotel_pbx_number, binotel_crm_base_url,
              binotel_credentials_present) ON public.automation_settings TO authenticated;
GRANT UPDATE (binotel_enabled, binotel_operator, binotel_pbx_number, binotel_crm_base_url)
  ON public.automation_settings TO authenticated;

REVOKE SELECT (binotel_key, binotel_secret) ON public.automation_settings FROM authenticated;
REVOKE SELECT (binotel_key, binotel_secret) ON public.automation_settings FROM anon;
REVOKE UPDATE (binotel_key, binotel_secret) ON public.automation_settings FROM authenticated;
REVOKE UPDATE (binotel_key, binotel_secret) ON public.automation_settings FROM anon;

-- 4. Запись ключей только через RPC админом.
-- SECURITY DEFINER (в отличие от save_sipuni_token) — чтобы функция работала
-- независимо от того, есть ли у роли колоночный UPDATE-грант.
CREATE OR REPLACE FUNCTION public.save_binotel_credentials(p_key text, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_key IS NULL OR trim(p_key) = '' OR p_secret IS NULL OR trim(p_secret) = '' THEN
    RAISE EXCEPTION 'key and secret are required';
  END IF;
  UPDATE public.automation_settings
     SET binotel_key = trim(p_key),
         binotel_secret = trim(p_secret)
   WHERE id = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_settings row missing';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_binotel_credentials(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.save_binotel_credentials(text, text) TO authenticated;

-- 5. Аудит входящих webhook-ов Binotel (apiCallSettings + apiCallCompleted)
CREATE TABLE IF NOT EXISTS public.binotel_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL CHECK (request_type IN ('apiCallSettings','apiCallCompleted')),
  general_call_id text,
  raw_payload jsonb,
  phone_normalized text,
  direction text CHECK (direction IN ('in','out')),
  disposition text,
  recording_url text,
  duration_sec int,
  started_at timestamptz,
  processing_status text NOT NULL
    CHECK (processing_status IN ('lead_found','lead_not_found','parse_error')),
  lead_id_resolved uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_binotel_call_log_created_at ON public.binotel_call_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_binotel_call_log_phone ON public.binotel_call_log (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_binotel_call_log_lead ON public.binotel_call_log (lead_id_resolved);
CREATE INDEX IF NOT EXISTS idx_binotel_call_log_status ON public.binotel_call_log (processing_status);
-- Один и тот же звонок Binotel может прислать до 7 раз (ретраи apiCallCompleted).
CREATE UNIQUE INDEX IF NOT EXISTS uq_binotel_call_log_completed
  ON public.binotel_call_log (general_call_id)
  WHERE request_type = 'apiCallCompleted' AND general_call_id IS NOT NULL;

ALTER TABLE public.binotel_call_log ENABLE ROW LEVEL SECURITY;

-- Админ: полный read
DROP POLICY IF EXISTS binotel_call_log_select_admin ON public.binotel_call_log;
CREATE POLICY binotel_call_log_select_admin
  ON public.binotel_call_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Участники проекта: только записи, привязанные к лиду их проекта
DROP POLICY IF EXISTS binotel_call_log_select_via_lead ON public.binotel_call_log;
CREATE POLICY binotel_call_log_select_via_lead
  ON public.binotel_call_log
  FOR SELECT
  TO authenticated
  USING (
    lead_id_resolved IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = binotel_call_log.lead_id_resolved
        AND (l.project_id IS NULL OR public.user_can_access_project(l.project_id))
    )
  );

-- INSERT/UPDATE/DELETE — только service_role (обходит RLS), политик нет.

-- 6. Поиск лида по телефону, устойчивый к формату записи номера.
-- Binotel присылает украинские номера как 0XXXXXXXXX, а в CRM телефон может
-- лежать как +380XXXXXXXXX / +38 (0XX) XXX-XX-XX — сравниваем последние 9 цифр.
CREATE OR REPLACE FUNCTION public.find_lead_by_phone_digits(p_phone text)
RETURNS TABLE (
  id uuid, project_id uuid, assigned_to uuid, phone text, name text, source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.project_id, l.assigned_to, l.phone, l.name, l.source
    FROM public.leads l
   WHERE length(regexp_replace(p_phone, '\D', '', 'g')) >= 9
     AND right(regexp_replace(l.phone, '\D', '', 'g'), 9)
       = right(regexp_replace(p_phone, '\D', '', 'g'), 9)
   ORDER BY l.created_at DESC
   LIMIT 1;
$$;

-- Индекс под ровно то же выражение, что и в WHERE — иначе seq scan по leads
-- на каждом входящем звонке (Binotel ждёт ответ, пока телефон звонит).
CREATE INDEX IF NOT EXISTS idx_leads_phone_tail9
  ON public.leads ((right(regexp_replace(phone, '\D', '', 'g'), 9)));

REVOKE ALL ON FUNCTION public.find_lead_by_phone_digits(text) FROM public;
GRANT EXECUTE ON FUNCTION public.find_lead_by_phone_digits(text) TO service_role;


-- ============================================================
-- 20260829130000_binotel_recordings_and_leads.sql
-- ============================================================

-- Binotel, вторая часть: постоянное хранение записей разговоров,
-- длительность звонка в ленте лида и автосоздание лида с неизвестного номера.

-- 1. Длительность звонка.
-- Поле callDurationSec уже читает LeadChatPanel, но заполнять его было нечем —
-- в communications не было колонки. Теперь есть.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS duration_sec int;

COMMENT ON COLUMN public.communications.duration_sec
  IS 'Длительность разговора в секундах (type=call)';

-- 2. Бакет для записей разговоров.
-- Ссылка Binotel на запись живёт 15 минут, поэтому в communications нельзя
-- складывать её как есть — качаем файл и храним у себя. Настройки бакета
-- повторяют crm-chat-media (там уже лежат голосовые клиентов из WhatsApp).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings', 'call-recordings', true, 104857600,
  ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/ogg','audio/webm']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "call_recordings_public_read" ON storage.objects;
CREATE POLICY "call_recordings_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'call-recordings');

-- Пишет только service_role (обходит RLS) — из edge-функции binotel-webhook.

-- 3. Автосоздание лида при звонке с неизвестного номера.
-- Классический сценарий Binotel + CRM: клиент позвонил впервые — карточка
-- появилась сама. Выключено по умолчанию: включать осознанно, иначе воронка
-- забьётся спамом и ошибочными наборами.
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS binotel_auto_create_leads boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS binotel_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.automation_settings.binotel_project_id
  IS 'В какой проект падают лиды, созданные из входящих звонков Binotel';

GRANT SELECT (binotel_auto_create_leads, binotel_project_id) ON public.automation_settings TO authenticated;
GRANT UPDATE (binotel_auto_create_leads, binotel_project_id) ON public.automation_settings TO authenticated;


-- ============================================================
-- 20260829140000_binotel_per_project.sql
-- ============================================================

-- Binotel: подключение переезжает из глобальных automation_settings в проект.
-- Одно подключение на проект (project_id — первичный ключ), у каждого проекта своя АТС.
-- Старые колонки binotel_* в automation_settings не удаляем (данные из них переносим
-- ниже), но код их больше не читает.

CREATE TABLE IF NOT EXISTS public.project_binotel_settings (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  api_key text,
  api_secret text,
  operator text,           -- внутренний номер по умолчанию
  pbx_number text,         -- внешний номер АТС; по нему webhook понимает, чей это звонок
  crm_base_url text,       -- база для ссылки в карточку лида
  auto_create_leads boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_binotel_settings
  ADD COLUMN IF NOT EXISTS credentials_present boolean
    GENERATED ALWAYS AS (
      api_key IS NOT NULL AND length(api_key) > 0
      AND api_secret IS NOT NULL AND length(api_secret) > 0
    ) STORED;

-- Номер АТС уникален: webhook маршрутизирует входящий звонок в проект именно по нему,
-- два проекта на одном номере сделали бы маршрутизацию неоднозначной.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_binotel_pbx_number
  ON public.project_binotel_settings (pbx_number)
  WHERE pbx_number IS NOT NULL AND pbx_number <> '';

-- Секреты недоступны клиенту ни на чтение, ни на запись.
REVOKE SELECT (api_key, api_secret) ON public.project_binotel_settings FROM PUBLIC, authenticated, anon;
REVOKE INSERT (api_key, api_secret) ON public.project_binotel_settings FROM PUBLIC, authenticated, anon;
REVOKE UPDATE (api_key, api_secret) ON public.project_binotel_settings FROM PUBLIC, authenticated, anon;

ALTER TABLE public.project_binotel_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pbs_select ON public.project_binotel_settings;
CREATE POLICY pbs_select ON public.project_binotel_settings
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- Менять подключение может администратор.
DROP POLICY IF EXISTS pbs_write ON public.project_binotel_settings;
CREATE POLICY pbs_write ON public.project_binotel_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Клиент читает через view без секретов.
DROP VIEW IF EXISTS public.project_binotel_settings_safe;
CREATE VIEW public.project_binotel_settings_safe
WITH (security_invoker = true) AS
SELECT
  project_id,
  enabled,
  operator,
  pbx_number,
  crm_base_url,
  auto_create_leads,
  credentials_present,
  updated_at
FROM public.project_binotel_settings;

COMMENT ON VIEW public.project_binotel_settings_safe IS
  'Подключение Binotel проекта без api_key/api_secret. Edge-функции читают базовую таблицу под service_role.';

GRANT SELECT ON public.project_binotel_settings_safe TO authenticated;

-- Запись ключей — только через RPC администратором.
CREATE OR REPLACE FUNCTION public.save_binotel_credentials(
  p_project_id uuid, p_key text, p_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;
  IF p_key IS NULL OR trim(p_key) = '' OR p_secret IS NULL OR trim(p_secret) = '' THEN
    RAISE EXCEPTION 'key and secret are required';
  END IF;

  INSERT INTO public.project_binotel_settings (project_id, api_key, api_secret, updated_at)
  VALUES (p_project_id, trim(p_key), trim(p_secret), now())
  ON CONFLICT (project_id) DO UPDATE
    SET api_key = EXCLUDED.api_key,
        api_secret = EXCLUDED.api_secret,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_binotel_credentials(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.save_binotel_credentials(uuid, text, text) TO authenticated;

-- Прошлая сигнатура (глобальная, без проекта) больше не нужна.
DROP FUNCTION IF EXISTS public.save_binotel_credentials(text, text);

-- Остальные поля — обычным upsert-ом, тоже админом.
CREATE OR REPLACE FUNCTION public.save_binotel_settings(
  p_project_id uuid,
  p_enabled boolean,
  p_operator text,
  p_pbx_number text,
  p_crm_base_url text,
  p_auto_create_leads boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  INSERT INTO public.project_binotel_settings AS s (
    project_id, enabled, operator, pbx_number, crm_base_url, auto_create_leads, updated_at
  )
  VALUES (
    p_project_id,
    COALESCE(p_enabled, false),
    NULLIF(trim(COALESCE(p_operator, '')), ''),
    NULLIF(trim(COALESCE(p_pbx_number, '')), ''),
    NULLIF(trim(COALESCE(p_crm_base_url, '')), ''),
    COALESCE(p_auto_create_leads, false),
    now()
  )
  ON CONFLICT (project_id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        operator = EXCLUDED.operator,
        pbx_number = EXCLUDED.pbx_number,
        crm_base_url = EXCLUDED.crm_base_url,
        auto_create_leads = EXCLUDED.auto_create_leads,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.save_binotel_settings(uuid, boolean, text, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.save_binotel_settings(uuid, boolean, text, text, text, boolean) TO authenticated;

-- Перенос уже настроенного подключения из глобальных настроек.
DO $migrate$
DECLARE
  s record;
  target uuid;
BEGIN
  SELECT * INTO s FROM public.automation_settings WHERE id = true;
  IF s IS NULL OR s.binotel_key IS NULL THEN
    RETURN;
  END IF;

  target := s.binotel_project_id;
  IF target IS NULL THEN
    SELECT id INTO target FROM public.projects LIMIT 2;
    -- переносим только когда проект однозначен
    IF (SELECT count(*) FROM public.projects) <> 1 THEN
      target := NULL;
    END IF;
  END IF;

  IF target IS NULL THEN
    RAISE NOTICE 'binotel: проект для переноса не определён, настройте подключение в интерфейсе';
    RETURN;
  END IF;

  INSERT INTO public.project_binotel_settings (
    project_id, enabled, api_key, api_secret, operator, pbx_number,
    crm_base_url, auto_create_leads
  )
  VALUES (
    target, COALESCE(s.binotel_enabled, false), s.binotel_key, s.binotel_secret,
    s.binotel_operator, s.binotel_pbx_number, s.binotel_crm_base_url,
    COALESCE(s.binotel_auto_create_leads, false)
  )
  ON CONFLICT (project_id) DO NOTHING;
END
$migrate$;

-- Поиск лида теперь можно ограничить проектом: у каждого проекта своя АТС,
-- и звонок на её номер должен искать клиента только среди лидов этого проекта.
DROP FUNCTION IF EXISTS public.find_lead_by_phone_digits(text);

CREATE OR REPLACE FUNCTION public.find_lead_by_phone_digits(
  p_phone text, p_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, project_id uuid, assigned_to uuid, phone text, name text, source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.project_id, l.assigned_to, l.phone, l.name, l.source
    FROM public.leads l
   WHERE length(regexp_replace(p_phone, '\D', '', 'g')) >= 9
     AND right(regexp_replace(l.phone, '\D', '', 'g'), 9)
       = right(regexp_replace(p_phone, '\D', '', 'g'), 9)
     AND (p_project_id IS NULL OR l.project_id = p_project_id)
   ORDER BY l.created_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_lead_by_phone_digits(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.find_lead_by_phone_digits(text, uuid) TO service_role;


-- ============================================================
-- 20260829150000_binotel_import_cron.sql
-- ============================================================

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


-- ============================================================
-- 20260829160000_binotel_settings_lockdown.sql
-- ============================================================

-- Безопасность подключения Binotel: секреты действительно недоступны клиенту.
--
-- Колоночный REVOKE (api_key, api_secret) — пустышка, если у роли есть табличный
-- грант: Postgres в этом случае просто предупреждает «no privileges could be revoked»,
-- а Supabase выдаёт GRANT ALL новым таблицам по умолчанию. Вместе с политикой на
-- SELECT это позволяло участнику проекта прочитать ключи через PostgREST.
--
-- Теперь базовая таблица недоступна клиенту вообще: с ней работают только
-- service_role (edge-функции) и SECURITY DEFINER функции. Клиент читает view.

REVOKE ALL ON public.project_binotel_settings FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS pbs_select ON public.project_binotel_settings;
DROP POLICY IF EXISTS pbs_write ON public.project_binotel_settings;

-- View с правами владельца (не security_invoker): RLS базовой таблицы обходится,
-- поэтому доступ проверяется здесь же и явно.
DROP VIEW IF EXISTS public.project_binotel_settings_safe;
CREATE VIEW public.project_binotel_settings_safe AS
SELECT
  project_id,
  enabled,
  operator,
  pbx_number,
  crm_base_url,
  auto_create_leads,
  credentials_present,
  updated_at
FROM public.project_binotel_settings
WHERE public.user_can_access_project(project_id);

COMMENT ON VIEW public.project_binotel_settings_safe IS
  'Подключение Binotel проекта без api_key/api_secret. Базовая таблица клиенту недоступна.';

REVOKE ALL ON public.project_binotel_settings_safe FROM PUBLIC, anon;
GRANT SELECT ON public.project_binotel_settings_safe TO authenticated;


