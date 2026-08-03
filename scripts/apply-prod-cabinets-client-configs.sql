-- ═══════════════════════════════════════════════════════════════════════════
-- PROD one-shot: кабинеты + client_configs (Юрча и все остальные)
-- Supabase SQL Editor → Run (проект szfgdruhlebfvcmlvxdk)
-- Идемпотентно — можно гонять повторно.
-- ═══════════════════════════════════════════════════════════════════════════

-- A) ad_cabinets: участники проекта могут читать/писать свои кабинеты
DROP POLICY IF EXISTS ad_cabinets_select_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_select_project ON public.ad_cabinets
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
  );

DROP POLICY IF EXISTS ad_cabinets_insert_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_insert_project ON public.ad_cabinets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (created_by IS NULL OR created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS ad_cabinets_update_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_update_project ON public.ad_cabinets
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
  );

DROP POLICY IF EXISTS ad_cabinets_delete_project ON public.ad_cabinets;
CREATE POLICY ad_cabinets_delete_project ON public.ad_cabinets
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
  );

DROP VIEW IF EXISTS public.ad_cabinets_safe;
CREATE VIEW public.ad_cabinets_safe
WITH (security_invoker = false)
AS
SELECT
  id, project_id, created_by, created_at, updated_at,
  name, external_id, online, type, provider,
  currency, daily_budget, spend, leads, lead_cost, sales, revenue,
  city, ad_account_id, page_id, page_name, instagram_id,
  telegram_group_id, whatsapp_number, pixel_id, pixel_event,
  website_url, landing_url, utm_template, brief,
  campaign_objective, optimization_goal, lead_form_id,
  start_time, end_time, days_of_week, timezone,
  auto_launch_enabled, launch_hour,
  target_geo, target_age_min, target_age_max, target_gender,
  target_languages, target_interests, target_exclusions,
  creative_headline, creative_primary_text, creative_description, creative_cta,
  creative_media_urls
FROM public.ad_cabinets
WHERE
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR created_by = auth.uid()
  OR (project_id IS NOT NULL AND public.user_can_access_project(project_id));

REVOKE ALL ON public.ad_cabinets_safe FROM PUBLIC, anon;
GRANT SELECT ON public.ad_cabinets_safe TO authenticated;

DROP POLICY IF EXISTS meta_tokens_write_admin ON public.meta_tokens;
DROP POLICY IF EXISTS meta_tokens_write_project ON public.meta_tokens;
CREATE POLICY meta_tokens_write_project ON public.meta_tokens
  FOR ALL TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));

-- B) client_configs: dual-write с фронта (JWT), SELECT токенов закрыт
ALTER TABLE public.client_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_config insert anon" ON public.client_configs;
DROP POLICY IF EXISTS "client_config select anon" ON public.client_configs;
DROP POLICY IF EXISTS client_configs_insert_authed ON public.client_configs;
DROP POLICY IF EXISTS client_configs_update_authed ON public.client_configs;
DROP POLICY IF EXISTS client_configs_delete_authed ON public.client_configs;

CREATE POLICY client_configs_insert_authed ON public.client_configs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY client_configs_update_authed ON public.client_configs
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY client_configs_delete_authed ON public.client_configs
  FOR DELETE TO authenticated USING (true);

GRANT INSERT, UPDATE, DELETE ON public.client_configs TO authenticated;

-- C) Зеркало: все ad_cabinets → client_configs (включая Юрча)
INSERT INTO public.client_configs (
  cabinet_id, name, type, daily_budget, city, ad_account_id,
  page_id, page_name, instagram_id, access_token,
  telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, brief
)
SELECT
  c.id,
  COALESCE(NULLIF(TRIM(c.name), ''), c.id::text),
  CASE WHEN c.type = 'Агентский' THEN 'Агентский' ELSE 'Личный' END,
  c.daily_budget,
  c.city,
  COALESCE(c.ad_account_id, c.external_id),
  c.page_id,
  c.page_name,
  c.instagram_id,
  c.access_token,
  c.telegram_group_id,
  c.whatsapp_number,
  c.pixel_id,
  COALESCE(c.pixel_event, 'Lead'),
  c.website_url,
  c.brief
FROM public.ad_cabinets c
ON CONFLICT (cabinet_id) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  daily_budget = EXCLUDED.daily_budget,
  city = EXCLUDED.city,
  ad_account_id = EXCLUDED.ad_account_id,
  page_id = EXCLUDED.page_id,
  page_name = EXCLUDED.page_name,
  instagram_id = EXCLUDED.instagram_id,
  access_token = COALESCE(EXCLUDED.access_token, public.client_configs.access_token),
  telegram_group_id = EXCLUDED.telegram_group_id,
  whatsapp_number = EXCLUDED.whatsapp_number,
  pixel_id = EXCLUDED.pixel_id,
  pixel_event = EXCLUDED.pixel_event,
  website_url = EXCLUDED.website_url,
  brief = EXCLUDED.brief;

-- D) Проверка Юрча + счётчики
SELECT
  'yurcha' AS check_name,
  cc.cabinet_id,
  cc.name,
  cc.ad_account_id,
  cc.page_id,
  cc.instagram_id,
  cc.pixel_id,
  CASE WHEN COALESCE(cc.access_token, '') = '' THEN 'нет токена' ELSE 'токен есть' END AS token_status
FROM public.client_configs cc
WHERE cc.name ILIKE '%юрч%' OR cc.name ILIKE '%yurch%';

SELECT
  (SELECT count(*) FROM public.ad_cabinets) AS ad_cabinets_count,
  (SELECT count(*) FROM public.client_configs) AS client_configs_count,
  (SELECT count(*) FROM public.ad_cabinets c
    WHERE NOT EXISTS (SELECT 1 FROM public.client_configs cc WHERE cc.cabinet_id = c.id)
  ) AS missing_mirrors;
