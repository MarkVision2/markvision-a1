
CREATE TABLE IF NOT EXISTS public.ad_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('structure_sync','daily_sync','creative_sync','wizard_test','greenapi_setup')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','error')),
  triggered_by text NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('auto','manual','wizard','cron')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_by uuid
);

CREATE INDEX IF NOT EXISTS ad_sync_runs_cabinet_idx ON public.ad_sync_runs(cabinet_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ad_sync_runs_project_idx ON public.ad_sync_runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ad_sync_runs_kind_idx ON public.ad_sync_runs(kind, started_at DESC);

ALTER TABLE public.ad_sync_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ad_sync_runs' AND policyname='ad_sync_runs_select_scoped') THEN
    CREATE POLICY "ad_sync_runs_select_scoped" ON public.ad_sync_runs FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.user_can_access_project(project_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ad_sync_runs' AND policyname='ad_sync_runs_write_admin') THEN
    CREATE POLICY "ad_sync_runs_write_admin" ON public.ad_sync_runs FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ad_sync_runs' AND policyname='ad_sync_runs_insert_authed') THEN
    CREATE POLICY "ad_sync_runs_insert_authed" ON public.ad_sync_runs FOR INSERT TO authenticated
      WITH CHECK (
        public.has_role(auth.uid(),'admin')
        OR public.user_can_access_project(project_id)
      );
  END IF;
END $$;

-- Триггер: при создании нового рекламного кабинета (provider='meta')
-- автоматически инициирует первую структурную синхронизацию через pg_net,
-- чтобы у пользователя сразу появились кампании/креативы без ручного шага.
CREATE OR REPLACE FUNCTION public.trg_ad_cabinet_kickoff_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_run_id uuid;
  v_url text;
  v_key text;
BEGIN
  IF COALESCE(NEW.provider, 'meta') <> 'meta' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.external_id, '') = '' THEN
    RETURN NEW;
  END IF;

  -- Создаём запись прогона со статусом running.
  INSERT INTO public.ad_sync_runs (cabinet_id, project_id, kind, status, triggered_by, payload)
  VALUES (NEW.id, NEW.project_id, 'structure_sync', 'running', 'auto',
          jsonb_build_object('cabinet_external_id', NEW.external_id))
  RETURNING id INTO v_run_id;

  -- Параметры окружения для pg_net (валидируем что доступны)
  v_url := current_setting('app.settings.supabase_url', true);
  v_key := current_setting('app.settings.service_role_key', true);

  IF v_url IS NULL OR v_key IS NULL OR v_url = '' OR v_key = '' THEN
    -- Тихо отмечаем, что трамплин невозможен в этой среде — синк подхватит cron.
    UPDATE public.ad_sync_runs
       SET status = 'success',
           finished_at = now(),
           payload = payload || jsonb_build_object('note', 'deferred_to_cron')
     WHERE id = v_run_id;
    RETURN NEW;
  END IF;

  PERFORM extensions.http_post(
    v_url || '/functions/v1/meta-structure-sync',
    jsonb_build_object('cabinet_id', NEW.id, 'run_id', v_run_id)::text,
    'application/json'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Никогда не блокируем INSERT кабинета из-за проблем с pg_net
  UPDATE public.ad_sync_runs
     SET status = 'error',
         finished_at = now(),
         error = SQLERRM
   WHERE id = v_run_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ad_cabinets_kickoff_sync ON public.ad_cabinets;
CREATE TRIGGER trg_ad_cabinets_kickoff_sync
  AFTER INSERT ON public.ad_cabinets
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ad_cabinet_kickoff_sync();
