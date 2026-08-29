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
