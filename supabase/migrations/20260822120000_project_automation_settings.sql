-- Per-project CRM automation settings (follow-up rules + stage message templates).
-- Keeps tenant secrets (cron_secret, meta tokens, telephony) in automation_settings singleton.

CREATE TABLE IF NOT EXISTS public.project_automation_settings (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  followup_2h_enabled boolean NOT NULL DEFAULT true,
  followup_2h_minutes integer NOT NULL DEFAULT 120,
  auto_msg_24h_enabled boolean NOT NULL DEFAULT true,
  auto_msg_24h_hours integer NOT NULL DEFAULT 24,
  auto_msg_24h_template_key text NOT NULL DEFAULT 'followup_24h',
  revival_7d_enabled boolean NOT NULL DEFAULT true,
  revival_7d_days integer NOT NULL DEFAULT 7,
  revival_7d_template_key text NOT NULL DEFAULT 'revival_7d',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_stage_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  title text NOT NULL DEFAULT '',
  template text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage_id)
);

CREATE INDEX IF NOT EXISTS idx_project_stage_automation_rules_project
  ON public.project_stage_automation_rules (project_id);

CREATE TABLE IF NOT EXISTS public.project_stage_automation_sent (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, lead_id, stage_id)
);

ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

UPDATE public.automation_runs ar
   SET project_id = l.project_id
  FROM public.leads l
 WHERE ar.lead_id = l.id
   AND ar.project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_runs_project_fired
  ON public.automation_runs (project_id, fired_at DESC);

-- Seed per-project settings from the legacy singleton row.
INSERT INTO public.project_automation_settings (
  project_id,
  followup_2h_enabled,
  followup_2h_minutes,
  auto_msg_24h_enabled,
  auto_msg_24h_hours,
  auto_msg_24h_template_key,
  revival_7d_enabled,
  revival_7d_days,
  revival_7d_template_key
)
SELECT
  p.id,
  s.followup_2h_enabled,
  s.followup_2h_minutes,
  s.auto_msg_24h_enabled,
  s.auto_msg_24h_hours,
  s.auto_msg_24h_template_key,
  s.revival_7d_enabled,
  s.revival_7d_days,
  s.revival_7d_template_key
FROM public.projects p
CROSS JOIN public.automation_settings s
WHERE s.id = true
ON CONFLICT (project_id) DO NOTHING;

ALTER TABLE public.project_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_stage_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_stage_automation_sent ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_automation_settings_select ON public.project_automation_settings;
CREATE POLICY project_automation_settings_select ON public.project_automation_settings
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS project_automation_settings_write ON public.project_automation_settings;
CREATE POLICY project_automation_settings_write ON public.project_automation_settings
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR project_id IN (SELECT id FROM public.projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR project_id IN (SELECT id FROM public.projects WHERE created_by = auth.uid())
  );

DROP POLICY IF EXISTS project_stage_automation_rules_select ON public.project_stage_automation_rules;
CREATE POLICY project_stage_automation_rules_select ON public.project_stage_automation_rules
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS project_stage_automation_rules_write ON public.project_stage_automation_rules;
CREATE POLICY project_stage_automation_rules_write ON public.project_stage_automation_rules
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR project_id IN (SELECT id FROM public.projects WHERE created_by = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR project_id IN (SELECT id FROM public.projects WHERE created_by = auth.uid())
  );

DROP POLICY IF EXISTS project_stage_automation_sent_select ON public.project_stage_automation_sent;
CREATE POLICY project_stage_automation_sent_select ON public.project_stage_automation_sent
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS project_stage_automation_sent_write ON public.project_stage_automation_sent;
CREATE POLICY project_stage_automation_sent_write ON public.project_stage_automation_sent
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_automation_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_stage_automation_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_stage_automation_sent TO authenticated;

DROP POLICY IF EXISTS automation_runs_select_admin ON public.automation_runs;
CREATE POLICY automation_runs_select_scoped ON public.automation_runs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
    )
  );

-- New projects inherit default follow-up settings.
CREATE OR REPLACE FUNCTION public.trg_project_automation_settings_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.project_automation_settings (project_id)
  VALUES (NEW.id)
  ON CONFLICT (project_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_automation_settings ON public.projects;
CREATE TRIGGER trg_projects_automation_settings
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.trg_project_automation_settings_default();
