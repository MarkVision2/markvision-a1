DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'cabinet_daily_insights'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.cabinet_daily_insights';
  END IF;
END$$;

ALTER TABLE public.cabinet_daily_insights REPLICA IDENTITY FULL;