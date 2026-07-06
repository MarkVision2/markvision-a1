-- =============================================================================
-- АУДИТ: сколько строк в каждой таблице (для переноса на szfg)
-- Запуск: Lovable SQL Editor → вставить ВЕСЬ файл → Run
-- =============================================================================

CREATE OR REPLACE FUNCTION public.audit_migration_counts()
RETURNS TABLE(
  tbl_name text,
  row_count bigint,
  action_hint text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  c bigint;
  tables text[] := ARRAY[
    'projects', 'project_members', 'user_active_project', 'project_briefs',
    'pipelines', 'pipeline_stages', 'loss_reasons',
    'ad_cabinets', 'cabinet_daily_insights', 'rnp_daily',
    'meta_campaigns', 'meta_campaign_daily',
    'meta_creatives', 'meta_creative_daily',
    'leads', 'lead_status_history', 'communications', 'tasks',
    'deals', 'events', 'phone_attribution', 'capi_outbox',
    'automation_settings', 'fx_rates',
    'instagram_accounts', 'instagram_codewords', 'instagram_organic_events',
    'instagram_media', 'instagram_daily', 'instagram_demographics',
    'finance_plans', 'report_subscriptions', 'quick_replies',
    'profiles', 'user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables ist
      WHERE ist.table_schema = 'public' AND ist.table_name = t
    ) THEN
      EXECUTE format('SELECT COUNT(*)::bigint FROM public.%I', t) INTO c;
      tbl_name := t;
      row_count := c;
      action_hint := CASE
        WHEN c = 0 THEN 'пусто'
        WHEN c < 100 THEN 'выгрузить (мало)'
        ELSE 'ВЫГРУЗИТЬ'
      END;
      RETURN NEXT;
    ELSE
      tbl_name := t;
      row_count := 0;
      action_hint := '— таблицы нет';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

SELECT * FROM public.audit_migration_counts()
ORDER BY
  CASE WHEN action_hint = '— таблицы нет' THEN 2 ELSE 1 END,
  row_count DESC,
  tbl_name;

-- Проекты (кратко)
SELECT
  p.name,
  (SELECT COUNT(*) FROM public.leads l WHERE l.project_id = p.id) AS leads,
  (SELECT COUNT(*) FROM public.ad_cabinets ac WHERE ac.project_id = p.id) AS cabinets,
  (SELECT COUNT(*) FROM public.meta_creatives mc WHERE mc.project_id = p.id) AS creatives
FROM public.projects p
ORDER BY p.name;

-- CDI по кабинетам
SELECT
  ac.name AS cabinet,
  p.name AS project,
  COUNT(c.*) AS cdi_rows,
  MIN(c.date) AS from_date,
  MAX(c.date) AS to_date,
  ROUND(SUM(c.spend)) AS total_spend_kzt
FROM public.ad_cabinets ac
LEFT JOIN public.projects p ON p.id = ac.project_id
LEFT JOIN public.cabinet_daily_insights c ON c.cabinet_id = ac.id
GROUP BY ac.id, ac.name, p.name
ORDER BY cdi_rows DESC;
