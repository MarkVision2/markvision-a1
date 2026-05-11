-- Make every project self-sufficient for incoming leads:
-- on creation it gets its own default pipeline + standard stages,
-- with the first stage being "Новая". The webhook then resolves to that
-- pipeline automatically — no manual setup, no UI step.

-- 1) Idempotent ensure-pipeline. Creates a default pipeline + the standard
--    sales funnel stages for the given project if one doesn't already exist.
CREATE OR REPLACE FUNCTION public.ensure_project_pipeline(p_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline_id uuid;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  -- Already has a default pipeline? Return it.
  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE project_id = p_project_id AND is_default = true
   LIMIT 1;
  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  -- Has a non-default pipeline? Promote it to default.
  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE project_id = p_project_id
   ORDER BY created_at ASC
   LIMIT 1;
  IF v_pipeline_id IS NOT NULL THEN
    UPDATE public.pipelines SET is_default = true WHERE id = v_pipeline_id;
    RETURN v_pipeline_id;
  END IF;

  -- Create new pipeline + standard stages. First stage = "Новая".
  INSERT INTO public.pipelines (name, is_default, project_id)
    VALUES ('Основная воронка', true, p_project_id)
    RETURNING id INTO v_pipeline_id;

  INSERT INTO public.pipeline_stages
    (pipeline_id, key, title, order_index, color, icon, is_terminal)
  VALUES
    (v_pipeline_id, 'new',         'Новая',          1, 'primary',     'zap',      false),
    (v_pipeline_id, 'no_answer',   'Без ответа',     2, 'warning',     'bell',     false),
    (v_pipeline_id, 'in_progress', 'В работе',       3, 'primary',     'message',  false),
    (v_pipeline_id, 'invoice',     'Счёт выставлен', 4, 'accent',      'card',     false),
    (v_pipeline_id, 'scheduled',   'Запись на визит',5, 'primary',     'calendar', false),
    (v_pipeline_id, 'visit',       'Визит',          6, 'success',     'map',      false),
    (v_pipeline_id, 'paid',        'Оплачено',       7, 'success',     'check',    true),
    (v_pipeline_id, 'rejected',    'Отказ',          8, 'destructive', 'ban',      true);

  RETURN v_pipeline_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_project_pipeline(uuid) TO authenticated, service_role;

-- 2) Trigger: every new project gets a default pipeline automatically.
CREATE OR REPLACE FUNCTION public.trg_projects_ensure_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_project_pipeline(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_ensure_pipeline ON public.projects;
CREATE TRIGGER projects_ensure_pipeline
AFTER INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.trg_projects_ensure_pipeline();

-- 3) Backfill: every existing project without a pipeline gets one.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.id
      FROM public.projects p
      LEFT JOIN public.pipelines pl ON pl.project_id = p.id
     WHERE pl.id IS NULL
  LOOP
    PERFORM public.ensure_project_pipeline(r.id);
  END LOOP;
END $$;
