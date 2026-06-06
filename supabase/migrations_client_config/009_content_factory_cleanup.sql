-- Автоочистка старого контента контент-завода (Clony / szfgdruhlebfvcmlvxdk)
-- Запуск: вручную, pg_cron (еженедельно) или edge function content-factory-cleanup

CREATE TABLE IF NOT EXISTS public.content_factory_cleanup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'sql',
  gallery_deleted int NOT NULL DEFAULT 0,
  results_deleted int NOT NULL DEFAULT 0,
  storage_deleted int NOT NULL DEFAULT 0,
  gallery_retention_days int NOT NULL,
  results_retention_days int NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cf_cleanup_log_ran_at
  ON public.content_factory_cleanup_log (ran_at DESC);

CREATE OR REPLACE FUNCTION public.cleanup_content_factory_data(
  p_gallery_days int DEFAULT 30,
  p_results_days int DEFAULT 14,
  p_write_log boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gallery_cutoff timestamptz;
  v_results_cutoff timestamptz;
  v_gallery_count int;
  v_results_count int;
  v_result jsonb;
BEGIN
  p_gallery_days := GREATEST(p_gallery_days, 7);
  p_results_days := GREATEST(p_results_days, 3);

  v_gallery_cutoff := now() - (p_gallery_days || ' days')::interval;
  v_results_cutoff := now() - (p_results_days || ' days')::interval;

  DELETE FROM public.content_factory_gallery
  WHERE created_at < v_gallery_cutoff;
  GET DIAGNOSTICS v_gallery_count = ROW_COUNT;

  DELETE FROM public.content_factory_results
  WHERE created_at < v_results_cutoff;
  GET DIAGNOSTICS v_results_count = ROW_COUNT;

  v_result := jsonb_build_object(
    'gallery_deleted', v_gallery_count,
    'results_deleted', v_results_count,
    'gallery_cutoff', v_gallery_cutoff,
    'results_cutoff', v_results_cutoff
  );

  IF p_write_log THEN
    INSERT INTO public.content_factory_cleanup_log (
      source,
      gallery_deleted,
      results_deleted,
      gallery_retention_days,
      results_retention_days,
      details
    ) VALUES (
      'sql',
      v_gallery_count,
      v_results_count,
      p_gallery_days,
      p_results_days,
      v_result
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_content_factory_data(int, int, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_content_factory_data(int, int, boolean) TO service_role;

COMMENT ON FUNCTION public.cleanup_content_factory_data IS
  'Удаляет записи галереи и results старше N дней. Storage чистит edge function content-factory-cleanup.';

-- Опционально: еженедельно по воскресеньям 03:00 UTC (нужны pg_cron + pg_net на Clony)
-- SELECT cron.unschedule('content-factory-weekly-cleanup')
-- WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-factory-weekly-cleanup');
--
-- SELECT cron.schedule(
--   'content-factory-weekly-cleanup',
--   '0 3 * * 0',
--   $$ SELECT public.cleanup_content_factory_data(30, 14); $$
-- );
