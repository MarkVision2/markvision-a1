-- РНП: ручные дневные показатели, которых нет в CRM/Meta (предоплаты и т.п.).
-- Уже применена к базе вручную 2026-06-11 — файл для истории схемы.
CREATE TABLE IF NOT EXISTS public.rnp_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  diag_revenue numeric NOT NULL DEFAULT 0,
  planned_diagnostics integer NOT NULL DEFAULT 0,
  conducted_diagnostics integer NOT NULL DEFAULT 0,
  prepayments_count integer NOT NULL DEFAULT 0,
  prepayments_sum numeric NOT NULL DEFAULT 0,
  cash_received numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rnp_daily_project_date_uniq
  ON public.rnp_daily (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), date);

ALTER TABLE public.rnp_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rnp_daily_select_scoped ON public.rnp_daily;
CREATE POLICY rnp_daily_select_scoped ON public.rnp_daily
  FOR SELECT TO authenticated
  USING (project_id IS NULL OR public.user_can_access_project(project_id));

DROP POLICY IF EXISTS rnp_daily_insert_scoped ON public.rnp_daily;
CREATE POLICY rnp_daily_insert_scoped ON public.rnp_daily
  FOR INSERT TO authenticated
  WITH CHECK (project_id IS NULL OR public.user_can_access_project(project_id));

DROP POLICY IF EXISTS rnp_daily_update_scoped ON public.rnp_daily;
CREATE POLICY rnp_daily_update_scoped ON public.rnp_daily
  FOR UPDATE TO authenticated
  USING (project_id IS NULL OR public.user_can_access_project(project_id))
  WITH CHECK (project_id IS NULL OR public.user_can_access_project(project_id));

DROP POLICY IF EXISTS rnp_daily_delete_scoped ON public.rnp_daily;
CREATE POLICY rnp_daily_delete_scoped ON public.rnp_daily
  FOR DELETE TO authenticated
  USING (project_id IS NULL OR public.user_can_access_project(project_id));
