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
