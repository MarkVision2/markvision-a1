-- =============================================================================
-- АУДИТ ДАННЫХ перед переносом Lovable → szfgdruhlebfvcmlvxdk
--
-- Запуск:
--   1) Lovable (mekwfbqmsqiborjdrjxc) — SQL Editor → что ВЫГРУЖАТЬ
--   2) szfgdruhlebfvcmlvxdk         — SQL Editor → что УЖЕ ЕСТЬ на цели
-- =============================================================================

-- ─── 1. Все public-таблицы с примерным числом строк ───────────────────────
SELECT
  relname AS table_name,
  n_live_tup AS approx_rows,
  pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(relname))) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;


-- ─── 2. Точные counts по ключевым таблицам MarkVision ───────────────────────
-- (функция — работает в Supabase SQL Editor одним Run)
CREATE OR REPLACE FUNCTION public.audit_migration_counts()
RETURNS TABLE(
  tbl_name text,
  row_count bigint,
  status text
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
    'profiles', 'user_roles',
    'content_factory_results', 'content_factory_gallery', 'content_projects'
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
      status := 'ok';
      RETURN NEXT;
    ELSE
      tbl_name := t;
      row_count := 0;
      status := 'missing';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

SELECT
  tbl_name AS table_name,
  row_count,
  CASE
    WHEN status = 'missing' THEN '— таблицы нет'
    WHEN row_count = 0 THEN 'пусто'
    WHEN row_count < 100 THEN 'мало — выгрузить'
    ELSE 'ВЫГРУЗИТЬ'
  END AS action_hint
FROM public.audit_migration_counts()
ORDER BY
  CASE WHEN status = 'missing' THEN 2 ELSE 1 END,
  row_count DESC,
  tbl_name;


-- ─── 3. Проекты и объём данных по каждому ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='projects') THEN
    RAISE NOTICE 'См. результат запроса projects ниже';
  ELSE
    RAISE NOTICE 'Таблица projects отсутствует — это не MarkVision-схема или db push ещё не делали';
  END IF;
END $$;

SELECT
  p.id,
  p.name,
  p.initials,
  p.created_at::date AS created,
  (SELECT COUNT(*) FROM public.leads l WHERE l.project_id = p.id) AS leads,
  (SELECT COUNT(*) FROM public.ad_cabinets ac WHERE ac.project_id = p.id) AS cabinets,
  (SELECT COUNT(*) FROM public.meta_creatives mc WHERE mc.project_id = p.id) AS creatives,
  (SELECT COUNT(*) FROM public.project_members pm WHERE pm.project_id = p.id) AS members
FROM public.projects p
ORDER BY p.name;


-- ─── 4. Кабинеты Meta + строки CDI ────────────────────────────────────────
SELECT
  ac.id AS cabinet_id,
  ac.name,
  ac.external_id,
  ac.provider,
  ac.project_id,
  p.name AS project_name,
  (SELECT COUNT(*) FROM public.cabinet_daily_insights c WHERE c.cabinet_id = ac.id) AS cdi_rows,
  (SELECT MIN(c.date) FROM public.cabinet_daily_insights c WHERE c.cabinet_id = ac.id) AS cdi_from,
  (SELECT MAX(c.date) FROM public.cabinet_daily_insights c WHERE c.cabinet_id = ac.id) AS cdi_to,
  ac.spend, ac.leads, ac.revenue
FROM public.ad_cabinets ac
LEFT JOIN public.projects p ON p.id = ac.project_id
ORDER BY cdi_rows DESC NULLS LAST;


-- ─── 5. CRM: лиды по стадиям (если есть leads + pipeline_stages) ───────────
SELECT
  p.name AS project,
  ps.key AS stage,
  ps.title AS stage_title,
  COUNT(l.id) AS leads,
  COUNT(*) FILTER (WHERE l.paid) AS paid,
  COALESCE(SUM(l.amount) FILTER (WHERE l.paid), 0) AS paid_revenue,
  COALESCE(SUM(l.diagnostic_amount), 0) AS diagnostic_revenue
FROM public.leads l
JOIN public.projects p ON p.id = l.project_id
JOIN public.pipeline_stages ps ON ps.id = l.stage_id
GROUP BY p.name, ps.key, ps.title, ps.order_index
ORDER BY p.name, ps.order_index;


-- ─── 6. Meta: креативы с превью и дневной статистикой ─────────────────────
SELECT
  mc.ad_id,
  mc.name,
  mc.creative_type,
  mc.effective_status,
  p.name AS project,
  CASE
    WHEN mc.poster_url IS NOT NULL THEN 'poster'
    WHEN mc.thumbnail_url IS NOT NULL THEN 'thumb'
    ELSE 'нет превью'
  END AS preview,
  (SELECT COUNT(*) FROM public.meta_creative_daily d WHERE d.ad_id = mc.ad_id) AS daily_rows,
  (SELECT COALESCE(SUM(d.spend), 0) FROM public.meta_creative_daily d WHERE d.ad_id = mc.ad_id) AS total_spend
FROM public.meta_creatives mc
LEFT JOIN public.projects p ON p.id = mc.project_id
ORDER BY total_spend DESC NULLS LAST
LIMIT 50;


-- ─── 7. CDI: суммарно по месяцам (расход / CRM) ───────────────────────────
SELECT
  date_trunc('month', cdi.date)::date AS month,
  COUNT(*) AS days,
  ROUND(SUM(cdi.spend)) AS spend,
  SUM(cdi.leads) AS meta_leads,
  SUM(cdi.crm_sales) AS crm_sales,
  ROUND(SUM(cdi.crm_revenue)) AS crm_revenue
FROM public.cabinet_daily_insights cdi
GROUP BY 1
ORDER BY 1 DESC;


-- ─── 8. Пользователи и роли ───────────────────────────────────────────────
SELECT COUNT(*) AS auth_users FROM auth.users;

SELECT role, COUNT(*) AS users
FROM public.user_roles
GROUP BY role
ORDER BY users DESC;

SELECT COUNT(*) AS profiles FROM public.profiles;


-- ─── 9. Storage: файлы в buckets ──────────────────────────────────────────
SELECT
  bucket_id,
  COUNT(*) AS files,
  pg_size_pretty(COALESCE(SUM((metadata->>'size')::bigint), 0)) AS approx_size
FROM storage.objects
GROUP BY bucket_id
ORDER BY COUNT(*) DESC;


-- ─── 10. automation_settings (Meta token) ───────────────────────────────────
SELECT
  id,
  (meta_access_token IS NOT NULL AND length(meta_access_token) > 10) AS has_meta_token,
  meta_access_token_present
FROM public.automation_settings
LIMIT 5;
