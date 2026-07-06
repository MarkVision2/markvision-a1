-- =============================================================================
-- ШАГ 1. SQL Editor → проект szfgdruhlebfvcmlvxdk (перед supabase db push)
--
-- На szfg уже живёт контент-завод + старые CF-таблицы (pipelines, pipeline_stages
-- из migrations_client_config). MarkVision-a1 создаёт ТЕ ЖЕ имена, но другую схему.
-- Переименовываем legacy, content_factory_* НЕ ТРОГАЕМ.
-- =============================================================================

DO $$
BEGIN
  -- leads (CF: fb_ad_id; MV: name + phone)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables ist
    WHERE ist.table_schema = 'public' AND ist.table_name = 'leads'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'name'
  ) THEN
    ALTER TABLE public.leads RENAME TO leads_legacy_szfg;
    RAISE NOTICE 'Renamed leads → leads_legacy_szfg';
  END IF;

  -- pipelines (CF: client_id; MV: project_id)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables ist
    WHERE ist.table_schema = 'public' AND ist.table_name = 'pipelines'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipelines' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE public.pipelines RENAME TO pipelines_legacy_szfg;
    RAISE NOTICE 'Renamed pipelines → pipelines_legacy_szfg';
  END IF;

  -- pipeline_stages (CF: position + capi_event; MV: key + title + order_index)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables ist
    WHERE ist.table_schema = 'public' AND ist.table_name = 'pipeline_stages'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_stages' AND column_name = 'position'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_stages' AND column_name = 'key'
  ) THEN
    ALTER TABLE public.pipeline_stages RENAME TO pipeline_stages_legacy_cf;
    RAISE NOTICE 'Renamed pipeline_stages → pipeline_stages_legacy_cf';
  END IF;

  -- lead_status_history (CF: capi_sent; MV: changed_by uuid без capi_sent)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables ist
    WHERE ist.table_schema = 'public' AND ist.table_name = 'lead_status_history'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lead_status_history' AND column_name = 'capi_sent'
  ) THEN
    ALTER TABLE public.lead_status_history RENAME TO lead_status_history_legacy_cf;
    RAISE NOTICE 'Renamed lead_status_history → lead_status_history_legacy_cf';
  END IF;
  -- automation_settings (чужая схема без cron_secret)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables ist
    WHERE ist.table_schema = 'public' AND ist.table_name = 'automation_settings'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'automation_settings' AND column_name = 'cron_secret'
  ) THEN
    ALTER TABLE public.automation_settings RENAME TO automation_settings_legacy_szfg;
    RAISE NOTICE 'Renamed automation_settings → automation_settings_legacy_szfg';
  END IF;

  -- inbound_tokens (legacy table; MV expects VIEW)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables ist
    WHERE ist.table_schema = 'public' AND ist.table_name = 'inbound_tokens' AND ist.table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE public.inbound_tokens RENAME TO inbound_tokens_legacy_szfg;
    RAISE NOTICE 'Renamed inbound_tokens → inbound_tokens_legacy_szfg';
  END IF;
END $$;

-- Диагностика перед db push
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='projects') AS has_mv_projects,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pipeline_stages') AS has_pipeline_stages,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pipeline_stages_legacy_cf') AS has_cf_stages_backup,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='pipelines_legacy_szfg') AS has_legacy_pipelines,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='content_factory_results') AS has_content_factory,
  (SELECT COUNT(*)::int FROM public.content_factory_results) AS content_factory_rows;
