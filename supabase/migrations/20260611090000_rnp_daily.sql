-- РНП (рука на пульсе): ручные дневные показатели, которых нет в CRM/Meta.
-- Авто-метрики (лиды, квалы, диагностики, оплаты) считаются из leads и
-- cabinet_daily_insights — здесь только то, что вносится руками.
CREATE TABLE IF NOT EXISTS public.rnp_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  -- Сумма по диагностикам (выручка с продажи диагностик), тг
  diag_revenue numeric NOT NULL DEFAULT 0,
  -- Диагностик спланировано на день (ручной факт, заменяет авто из next_visit_at)
  planned_diagnostics integer NOT NULL DEFAULT 0,
  -- Диагностик проведено (ручной факт, заменяет авто)
  conducted_diagnostics integer NOT NULL DEFAULT 0,
  -- Предоплат получено, шт
  prepayments_count integer NOT NULL DEFAULT 0,
  -- Сумма предоплат, тг
  prepayments_sum numeric NOT NULL DEFAULT 0,
  -- Денег в кассе (фактически поступило за день), тг
  cash_received numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Одна строка на проект+день (NULL project_id схлопывается в один ключ)
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
