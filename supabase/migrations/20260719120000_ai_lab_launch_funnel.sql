-- AI Marketing Lab launch funnel for MarkVision AI project only.
-- Adds stage_role, lead tags/temperature/webinar fields, automation audit table,
-- and replaces pipeline stages for project cceb9a86-687b-4417-9b4e-d106bd8cc79c.

-- 1) pipelines.template_key
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS template_key text;

COMMENT ON COLUMN public.pipelines.template_key IS
  'Pipeline template: clinic (default) | launch (AI Marketing Lab webinar funnel)';

-- 2) pipeline_stages.stage_role — semantic behavior independent of display key
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS stage_role text NOT NULL DEFAULT 'other';

COMMENT ON COLUMN public.pipeline_stages.stage_role IS
  'Semantic role: new|whatsapp|warming|confirmed|attended|interest|call_scheduled|call_done|offer|deposit|paid|student|rejected|other';

-- Backfill clinic defaults from existing keys
UPDATE public.pipeline_stages SET stage_role = 'new'            WHERE key = 'new' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'whatsapp'       WHERE key IN ('no_answer') AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'interest'       WHERE key = 'in_progress' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'offer'          WHERE key = 'invoice' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'call_scheduled' WHERE key = 'scheduled' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'attended'       WHERE key = 'visit' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'paid'           WHERE key = 'paid' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'rejected'       WHERE key = 'rejected' AND stage_role = 'other';

-- 3) leads extensions for launch funnel
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS temperature text,
  ADD COLUMN IF NOT EXISTS webinar_status text,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS cohort text;

COMMENT ON COLUMN public.leads.temperature IS 'hot|warm|cold';
COMMENT ON COLUMN public.leads.webinar_status IS 'attended|late|no_show|null';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_temperature_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_temperature_check
      CHECK (temperature IS NULL OR temperature IN ('hot', 'warm', 'cold'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_webinar_status_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_webinar_status_check
      CHECK (webinar_status IS NULL OR webinar_status IN ('attended', 'late', 'no_show'));
  END IF;
END $$;

-- 4) Automation audit / idempotency
CREATE TABLE IF NOT EXISTS public.crm_automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  event text NOT NULL,
  idempotency_key text NOT NULL,
  from_stage_id uuid,
  to_stage_id uuid,
  confidence numeric,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'n8n',
  status text NOT NULL DEFAULT 'applied',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_automation_events_status_check
    CHECK (status IN ('applied', 'skipped', 'duplicate', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_events_idempotency_uidx
  ON public.crm_automation_events (project_id, idempotency_key);

CREATE INDEX IF NOT EXISTS crm_automation_events_lead_idx
  ON public.crm_automation_events (lead_id, created_at DESC);

ALTER TABLE public.crm_automation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_automation_events_select_members ON public.crm_automation_events;
CREATE POLICY crm_automation_events_select_members
  ON public.crm_automation_events
  FOR SELECT
  TO authenticated
  USING (
    project_id IS NULL
    OR public.is_project_member(project_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- service_role bypasses RLS; no insert policy for authenticated (edge only)

-- 5) Replace MarkVision AI pipeline stages with launch funnel
DO $$
DECLARE
  v_project_id uuid := 'cceb9a86-687b-4417-9b4e-d106bd8cc79c';
  v_pipeline_id uuid;
  v_new_stage_id uuid;
BEGIN
  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE project_id = v_project_id AND is_default = true
  ORDER BY created_at
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    SELECT id INTO v_pipeline_id
    FROM public.pipelines
    WHERE project_id = v_project_id
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF v_pipeline_id IS NULL THEN
    RAISE NOTICE 'MarkVision AI pipeline not found — skip stage replace';
    RETURN;
  END IF;

  UPDATE public.pipelines
  SET name = 'AI Marketing Lab',
      template_key = 'launch',
      updated_at = now()
  WHERE id = v_pipeline_id;

  -- Point any leftover leads at a temporary placeholder before delete
  -- (CRM was wiped; this is safety for any residual rows).
  INSERT INTO public.pipeline_stages (
    pipeline_id, key, title, order_index, color, icon, is_terminal, is_diagnostic, stage_role
  ) VALUES (
    v_pipeline_id, '_tmp_new', 'Новый лид', 0, 'primary', 'zap', false, false, 'new'
  )
  ON CONFLICT (pipeline_id, key) DO NOTHING
  RETURNING id INTO v_new_stage_id;

  IF v_new_stage_id IS NULL THEN
    SELECT id INTO v_new_stage_id
    FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id AND key = '_tmp_new'
    LIMIT 1;
  END IF;

  IF v_new_stage_id IS NOT NULL THEN
    UPDATE public.leads
    SET stage_id = v_new_stage_id
    WHERE pipeline_id = v_pipeline_id
      AND stage_id IN (
        SELECT id FROM public.pipeline_stages
        WHERE pipeline_id = v_pipeline_id AND key <> '_tmp_new'
      );
  END IF;

  DELETE FROM public.pipeline_stages
  WHERE pipeline_id = v_pipeline_id
    AND key <> '_tmp_new';

  -- Insert launch stages. Keep system keys where UI/CAPI historically expect them:
  -- new, scheduled, visit, invoice, paid, rejected.
  INSERT INTO public.pipeline_stages (
    pipeline_id, key, title, order_index, color, icon, is_terminal, is_diagnostic, stage_role
  ) VALUES
    (v_pipeline_id, 'new',        'Новый лид',              1,  'primary',     'zap',      false, false, 'new'),
    (v_pipeline_id, 'whatsapp',   'Написал в WhatsApp',     2,  'primary',     'message',  false, false, 'whatsapp'),
    (v_pipeline_id, 'warming',    'Прогрев',                3,  'warning',     'bell',     false, false, 'warming'),
    (v_pipeline_id, 'confirmed',  'Подтвердил участие',     4,  'warning',     'calendar', false, false, 'confirmed'),
    (v_pipeline_id, 'visit',      'Посетил вебинар',        5,  'warning',     'map',      false, false, 'attended'),
    (v_pipeline_id, 'interest',   'Проявил интерес',        6,  'warning',     'zap',      false, false, 'interest'),
    (v_pipeline_id, 'scheduled',  'Созвон назначен',        7,  'accent',      'calendar', false, false, 'call_scheduled'),
    (v_pipeline_id, 'call_done',  'Созвон проведён',        8,  'accent',      'message',  false, false, 'call_done'),
    (v_pipeline_id, 'invoice',    'Предложение отправлено', 9,  'accent',      'card',     false, false, 'offer'),
    (v_pipeline_id, 'deposit',    'Бронь 10 000 ₸',         10, 'success',     'card',     false, false, 'deposit'),
    (v_pipeline_id, 'paid',       'Полная оплата',          11, 'success',     'check',    true,  false, 'paid'),
    (v_pipeline_id, 'student',    'Студент',                12, 'success',     'check',    true,  false, 'student'),
    (v_pipeline_id, 'rejected',   'Отказ / потерян',        13, 'destructive', 'ban',      true,  false, 'rejected');

  -- Remap leads from tmp → real new, then drop tmp
  SELECT id INTO v_new_stage_id
  FROM public.pipeline_stages
  WHERE pipeline_id = v_pipeline_id AND key = 'new'
  LIMIT 1;

  UPDATE public.leads
  SET stage_id = v_new_stage_id
  WHERE pipeline_id = v_pipeline_id
    AND stage_id IN (
      SELECT id FROM public.pipeline_stages
      WHERE pipeline_id = v_pipeline_id AND key = '_tmp_new'
    );

  DELETE FROM public.pipeline_stages
  WHERE pipeline_id = v_pipeline_id AND key = '_tmp_new';
END $$;

-- 6) Enrich stage_changed payload with stage_role (best-effort; keep existing trigger body if replace fails)
CREATE OR REPLACE FUNCTION public.on_lead_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_key text;
  _to_key text;
  _to_is_diag boolean;
  _to_role text;
  _from_role text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT key, is_diagnostic, stage_role
      INTO _to_key, _to_is_diag, _to_role
    FROM public.pipeline_stages WHERE id = NEW.stage_id;

    SELECT key, stage_role
      INTO _from_key, _from_role
    FROM public.pipeline_stages WHERE id = OLD.stage_id;

    INSERT INTO public.lead_status_history (lead_id, from_stage_id, to_stage_id, changed_by)
    VALUES (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());

    INSERT INTO public.events (lead_id, event_type, payload, actor_id)
    VALUES (
      NEW.id,
      'stage_changed',
      jsonb_build_object(
        'from', OLD.stage_id,
        'to', NEW.stage_id,
        'from_key', _from_key,
        'to_key', _to_key,
        'to_is_diagnostic', COALESCE(_to_is_diag, false),
        'from_stage_role', _from_role,
        'to_stage_role', _to_role
      ),
      auth.uid()
    );

    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$$;
