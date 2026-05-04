-- 1. Расширяем leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;

-- Бэкфил из communications
UPDATE public.leads l SET
  last_inbound_at = sub.last_in,
  last_outbound_at = sub.last_out
FROM (
  SELECT lead_id,
    MAX(CASE WHEN direction = 'in' THEN created_at END) AS last_in,
    MAX(CASE WHEN direction = 'out' AND is_draft = false THEN created_at END) AS last_out
  FROM public.communications
  GROUP BY lead_id
) sub
WHERE l.id = sub.lead_id;

-- 2. is_auto в communications
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false;

-- 3. Новый тип задачи
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'revival' AND enumtypid = 'task_type'::regtype) THEN
    ALTER TYPE task_type ADD VALUE 'revival';
  END IF;
END$$;

-- 4. Триггер обновляем — теперь пишет last_in/out
CREATE OR REPLACE FUNCTION public.on_communication_inserted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.leads
  SET last_contact_at = NEW.created_at,
      last_activity_at = NEW.created_at,
      last_inbound_at = CASE WHEN NEW.direction = 'in' THEN NEW.created_at ELSE last_inbound_at END,
      last_outbound_at = CASE WHEN NEW.direction = 'out' AND NEW.is_draft = false THEN NEW.created_at ELSE last_outbound_at END,
      first_response_at = COALESCE(first_response_at,
        CASE WHEN NEW.direction = 'out' AND NEW.is_draft = false THEN NEW.created_at ELSE NULL END)
  WHERE id = NEW.lead_id;

  INSERT INTO public.events (lead_id, event_type, payload, actor_id)
  VALUES (NEW.lead_id,
    CASE WHEN NEW.type = 'call' THEN 'call_made' ELSE 'message_sent' END,
    jsonb_build_object('direction', NEW.direction, 'channel', NEW.channel, 'is_draft', NEW.is_draft, 'is_auto', NEW.is_auto),
    NEW.created_by);
  RETURN NEW;
END;
$function$;

-- Привязываем триггер если нет
DROP TRIGGER IF EXISTS trg_on_communication_inserted ON public.communications;
CREATE TRIGGER trg_on_communication_inserted
AFTER INSERT ON public.communications
FOR EACH ROW EXECUTE FUNCTION public.on_communication_inserted();

-- 5. automation_settings (singleton)
CREATE TABLE IF NOT EXISTS public.automation_settings (
  id boolean PRIMARY KEY DEFAULT true,
  followup_2h_enabled boolean NOT NULL DEFAULT true,
  followup_2h_minutes integer NOT NULL DEFAULT 120,
  auto_msg_24h_enabled boolean NOT NULL DEFAULT true,
  auto_msg_24h_hours integer NOT NULL DEFAULT 24,
  auto_msg_24h_template_key text NOT NULL DEFAULT 'followup_24h',
  revival_7d_enabled boolean NOT NULL DEFAULT true,
  revival_7d_days integer NOT NULL DEFAULT 7,
  revival_7d_template_key text NOT NULL DEFAULT 'revival_7d',
  cron_secret text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton_check CHECK (id = true)
);

INSERT INTO public.automation_settings (id, cron_secret)
VALUES (true, 'b56e5379b3bb492ceb90f1a4e624c07c8e2971d28b7a5ffdab4ef44694246b69')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_settings_select_authed" ON public.automation_settings;
CREATE POLICY "automation_settings_select_authed"
ON public.automation_settings FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "automation_settings_update_admin" ON public.automation_settings;
CREATE POLICY "automation_settings_update_admin"
ON public.automation_settings FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_automation_settings_updated_at
BEFORE UPDATE ON public.automation_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Скрываем cron_secret от не-админов через view
CREATE OR REPLACE VIEW public.automation_settings_safe AS
SELECT id, followup_2h_enabled, followup_2h_minutes,
       auto_msg_24h_enabled, auto_msg_24h_hours, auto_msg_24h_template_key,
       revival_7d_enabled, revival_7d_days, revival_7d_template_key,
       updated_at,
       CASE WHEN has_role(auth.uid(), 'admin'::app_role) THEN cron_secret ELSE NULL END AS cron_secret
FROM public.automation_settings;

GRANT SELECT ON public.automation_settings_safe TO authenticated;

-- 6. automation_runs (журнал)
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  rule text NOT NULL,
  bucket_at timestamptz NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  UNIQUE (lead_id, rule, bucket_at)
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_lead ON public.automation_runs (lead_id, rule, fired_at DESC);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_runs_select_admin" ON public.automation_runs;
CREATE POLICY "automation_runs_select_admin"
ON public.automation_runs FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- INSERT/UPDATE/DELETE — только service role (никаких политик = запрет для authenticated)