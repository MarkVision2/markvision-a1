
-- 1) Сужаем SELECT на ad_cabinets до админов.
DROP POLICY IF EXISTS "ad_cabinets_select_scoped" ON public.ad_cabinets;
-- admin SELECT по-прежнему доступен через существующую "ad_cabinets_write_admin" (ALL).

-- 2) Безопасный view без секретов, видимый владельцам проектов.
--    security_invoker=false — view выполняется от лица владельца (обходит RLS таблицы),
--    видимость рядов контролируется WHERE внутри view.
CREATE OR REPLACE VIEW public.ad_cabinets_safe
WITH (security_invoker = false)
AS
SELECT
  id, project_id, created_by, created_at, updated_at,
  name, external_id, online, type, provider, currency, daily_budget,
  spend, leads, lead_cost, sales, revenue,
  city, page_name, instagram_id, telegram_group_id, whatsapp_number,
  pixel_event, website_url, landing_url, utm_template,
  brief, campaign_objective, optimization_goal, lead_form_id,
  start_time, end_time, days_of_week, timezone,
  auto_launch_enabled, launch_hour,
  target_geo, target_age_min, target_age_max, target_gender,
  target_languages, target_interests, target_exclusions,
  creative_headline, creative_primary_text, creative_description,
  creative_cta, creative_media_urls
FROM public.ad_cabinets
WHERE
  public.has_role(auth.uid(), 'admin')
  OR created_by = auth.uid()
  OR project_id IN (
    SELECT p.id FROM public.projects p WHERE p.created_by = auth.uid()
  );

REVOKE ALL ON public.ad_cabinets_safe FROM PUBLIC, anon;
GRANT SELECT ON public.ad_cabinets_safe TO authenticated;

-- 3) Явные admin-only INSERT/DELETE для automation_settings (single-row design).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='automation_settings' AND policyname='automation_settings_insert_admin') THEN
    CREATE POLICY "automation_settings_insert_admin" ON public.automation_settings
      FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='automation_settings' AND policyname='automation_settings_delete_admin') THEN
    CREATE POLICY "automation_settings_delete_admin" ON public.automation_settings
      FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
  END IF;
END $$;
