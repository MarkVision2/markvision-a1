-- =============================================================================
-- ЭКСПОРТ ДАННЫХ Lovable БЕЗ пароля БД и БЕЗ service role
--
-- Где: Lovable → Supabase → SQL Editor (проект mekwfbqmsqiborjdrjxc)
-- Запуск: весь файл → Run (может занять 10–30 сек)
--
-- Результат: одна колонка `line` с INSERT-ами.
--   Supabase SQL Editor → результат → Export CSV (или скопировать колонку line)
--   Сохранить как: tmp/lovable-dump/manual/all.sql
--
-- Импорт на szfg:
--   export SUPABASE_DB_PASSWORD='...'
--   ./scripts/migrate-to-szfg/04-import-data.sh ./tmp/lovable-dump/manual
--   (положите all.sql или разбейте по таблицам: projects.sql, leads.sql, …)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mv_export_table_inserts(p_table text)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col_list text;
  rec record;
  j jsonb;
  col_name text;
  val_list text;
  v jsonb;
  t text;
BEGIN
  IF p_table !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'invalid table: %', p_table;
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO col_list
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = p_table;

  IF col_list IS NULL THEN
    RETURN;
  END IF;

  FOR rec IN EXECUTE format('SELECT row_to_json(t)::jsonb AS j FROM public.%I t', p_table) LOOP
    j := rec.j;
    val_list := '';

    FOR col_name IN
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = p_table
      ORDER BY ordinal_position
    LOOP
      v := j -> col_name;
      IF val_list <> '' THEN
        val_list := val_list || ', ';
      END IF;

      IF v IS NULL OR v = 'null'::jsonb THEN
        val_list := val_list || 'NULL';
      ELSE
        t := jsonb_typeof(v);
        IF t = 'boolean' THEN
          val_list := val_list || CASE WHEN v::text = 'true' THEN 'TRUE' ELSE 'FALSE' END;
        ELSIF t = 'number' THEN
          val_list := val_list || (j ->> col_name);
        ELSIF t IN ('array', 'object') THEN
          val_list := val_list || quote_literal(v::text) || '::jsonb';
        ELSE
          val_list := val_list || quote_literal(j ->> col_name);
        END IF;
      END IF;
    END LOOP;

    RETURN NEXT format(
      'INSERT INTO public.%I (%s) VALUES (%s);',
      p_table,
      col_list,
      val_list
    );
  END LOOP;
END;
$$;

-- Порядок важен (foreign keys)
WITH exports AS (
  SELECT 1 AS ord, 'projects' AS tbl
  UNION ALL SELECT 2, 'project_members'
  UNION ALL SELECT 3, 'user_active_project'
  UNION ALL SELECT 4, 'pipelines'
  UNION ALL SELECT 5, 'pipeline_stages'
  UNION ALL SELECT 6, 'loss_reasons'
  UNION ALL SELECT 7, 'ad_cabinets'
  UNION ALL SELECT 8, 'automation_settings'
  UNION ALL SELECT 9, 'fx_rates'
  UNION ALL SELECT 10, 'cabinet_daily_insights'
  UNION ALL SELECT 11, 'meta_campaigns'
  UNION ALL SELECT 12, 'meta_campaign_daily'
  UNION ALL SELECT 13, 'meta_creatives'
  UNION ALL SELECT 14, 'meta_creative_daily'
  UNION ALL SELECT 15, 'leads'
  UNION ALL SELECT 16, 'lead_status_history'
  UNION ALL SELECT 17, 'communications'
  UNION ALL SELECT 18, 'tasks'
  UNION ALL SELECT 19, 'deals'
  UNION ALL SELECT 20, 'events'
  UNION ALL SELECT 21, 'rnp_daily'
  UNION ALL SELECT 22, 'instagram_accounts'
  UNION ALL SELECT 23, 'instagram_codewords'
  UNION ALL SELECT 24, 'instagram_organic_events'
  UNION ALL SELECT 25, 'instagram_media'
  UNION ALL SELECT 26, 'instagram_daily'
  UNION ALL SELECT 27, 'instagram_demographics'
  UNION ALL SELECT 28, 'phone_attribution'
  UNION ALL SELECT 29, 'capi_outbox'
  UNION ALL SELECT 30, 'project_briefs'
  UNION ALL SELECT 31, 'finance_plans'
  UNION ALL SELECT 32, 'report_subscriptions'
  UNION ALL SELECT 33, 'quick_replies'
  UNION ALL SELECT 34, 'profiles'
  UNION ALL SELECT 35, 'user_roles'
)
SELECT e.tbl AS table_name, ins.line
FROM exports e
CROSS JOIN LATERAL public.mv_export_table_inserts(e.tbl) AS ins(line)
ORDER BY e.ord, ins.line;

-- После успешного экспорта можно удалить функцию на Lovable:
-- DROP FUNCTION IF EXISTS public.mv_export_table_inserts(text);
