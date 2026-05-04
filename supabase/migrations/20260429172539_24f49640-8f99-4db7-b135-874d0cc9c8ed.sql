-- ============================================================
-- 1. ENUMS
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'manager');
CREATE TYPE public.task_type AS ENUM ('call', 'followup', 'visit', 'other');
CREATE TYPE public.task_status AS ENUM ('pending', 'done', 'overdue', 'cancelled');
CREATE TYPE public.deal_status AS ENUM ('pending', 'paid', 'cancelled');
CREATE TYPE public.payment_method AS ENUM ('cash', 'card', 'kaspi', 'transfer');
CREATE TYPE public.communication_type AS ENUM ('call', 'message', 'note');
CREATE TYPE public.communication_channel AS ENUM ('whatsapp', 'telegram', 'instagram', 'phone', 'web', 'email');
CREATE TYPE public.communication_direction AS ENUM ('in', 'out');
CREATE TYPE public.lead_channel AS ENUM ('whatsapp', 'telegram', 'instagram', 'phone', 'web');

-- ============================================================
-- 2. updated_at trigger function (idempotent)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. PROFILES
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. USER_ROLES + has_role()
-- ============================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- ============================================================
-- 5. PIPELINES + STAGES
-- ============================================================
CREATE TABLE public.pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_pipelines_updated_at
BEFORE UPDATE ON public.pipelines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT 'primary',
  icon TEXT NOT NULL DEFAULT 'zap',
  is_terminal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, key)
);
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_stages_updated_at
BEFORE UPDATE ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_stages_pipeline_order ON public.pipeline_stages(pipeline_id, order_index);

-- ============================================================
-- 6. LOSS REASONS
-- ============================================================
CREATE TABLE public.loss_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  emoji TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.loss_reasons ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. LEADS
-- ============================================================
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE RESTRICT,
  stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  campaign TEXT,
  channel lead_channel,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ai_score INTEGER NOT NULL DEFAULT 50 CHECK (ai_score BETWEEN 0 AND 100),
  note TEXT,
  service TEXT,
  city TEXT,
  age INTEGER,
  utm JSONB,
  referrer TEXT,
  landing_url TEXT,
  first_touch_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  next_visit_at TIMESTAMPTZ,
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  payment_method payment_method,
  rejected_at TIMESTAMPTZ,
  reject_reason TEXT,
  pinned BOOLEAN NOT NULL DEFAULT false,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_leads_stage ON public.leads(stage_id);
CREATE INDEX idx_leads_assignee ON public.leads(assigned_to);
CREATE INDEX idx_leads_created ON public.leads(created_at DESC);
CREATE INDEX idx_leads_pinned ON public.leads(pinned) WHERE pinned = true;

-- ============================================================
-- 8. LEAD STATUS HISTORY
-- ============================================================
CREATE TABLE public.lead_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_status_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_lsh_lead ON public.lead_status_history(lead_id, changed_at DESC);

-- ============================================================
-- 9. COMMUNICATIONS
-- ============================================================
CREATE TABLE public.communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  type communication_type NOT NULL,
  channel communication_channel,
  direction communication_direction,
  content TEXT,
  status TEXT,
  is_draft BOOLEAN NOT NULL DEFAULT false,
  template_key TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_comm_lead ON public.communications(lead_id, created_at DESC);

-- ============================================================
-- 10. TASKS
-- ============================================================
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type task_type NOT NULL DEFAULT 'followup',
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status task_status NOT NULL DEFAULT 'pending',
  done_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'sla' | 'followup' | 'revival' | 'ai'
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_tasks_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_tasks_lead ON public.tasks(lead_id);
CREATE INDEX idx_tasks_assignee_due ON public.tasks(assigned_to, due_at);
CREATE INDEX idx_tasks_pending_due ON public.tasks(due_at) WHERE status = 'pending';

-- ============================================================
-- 11. DEALS
-- ============================================================
CREATE TABLE public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  status deal_status NOT NULL DEFAULT 'pending',
  payment_method payment_method,
  service_type TEXT,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_deals_updated_at
BEFORE UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_deals_lead ON public.deals(lead_id);

-- ============================================================
-- 12. EVENTS (append-only audit log)
-- ============================================================
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_events_lead ON public.events(lead_id, created_at DESC);
CREATE INDEX idx_events_type ON public.events(event_type, created_at DESC);

-- ============================================================
-- 13. RLS POLICIES
-- ============================================================

-- Helper expression: lead is visible to current user
-- (admin sees all, manager sees own + unassigned)

-- profiles
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- user_roles
CREATE POLICY "user_roles_select_own_or_admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "user_roles_admin_write" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- pipelines
CREATE POLICY "pipelines_select_authed" ON public.pipelines
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pipelines_admin_write" ON public.pipelines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- pipeline_stages
CREATE POLICY "stages_select_authed" ON public.pipeline_stages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "stages_admin_write" ON public.pipeline_stages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- loss_reasons
CREATE POLICY "loss_reasons_select_authed" ON public.loss_reasons
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "loss_reasons_admin_write" ON public.loss_reasons
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- leads
CREATE POLICY "leads_select_visible" ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
    OR assigned_to IS NULL
  );
CREATE POLICY "leads_insert_authed" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (assigned_to IS NULL OR assigned_to = auth.uid() OR public.has_role(auth.uid(),'admin'))
  );
CREATE POLICY "leads_update_visible" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
    OR assigned_to IS NULL
  );
CREATE POLICY "leads_delete_admin" ON public.leads
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- lead_status_history
CREATE POLICY "lsh_select_via_lead" ON public.lead_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_status_history.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
  ));
CREATE POLICY "lsh_insert_authed" ON public.lead_status_history
  FOR INSERT TO authenticated WITH CHECK (true);

-- communications
CREATE POLICY "comm_select_via_lead" ON public.communications
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = communications.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
  ));
CREATE POLICY "comm_insert_authed" ON public.communications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = communications.lead_id
        AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
    )
  );
CREATE POLICY "comm_update_via_lead" ON public.communications
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = communications.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid())
  ));
CREATE POLICY "comm_delete_admin" ON public.communications
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- tasks
CREATE POLICY "tasks_select_visible" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id AND (l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
    )
  );
CREATE POLICY "tasks_insert_authed" ON public.tasks
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tasks_update_visible" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id AND l.assigned_to = auth.uid()
    )
  );
CREATE POLICY "tasks_delete_visible" ON public.tasks
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR assigned_to = auth.uid()
  );

-- deals
CREATE POLICY "deals_select_via_lead" ON public.deals
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = deals.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
  ));
CREATE POLICY "deals_write_via_lead" ON public.deals
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = deals.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = deals.lead_id
      AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid())
  ));

-- events
CREATE POLICY "events_select_via_lead" ON public.events
  FOR SELECT TO authenticated
  USING (
    lead_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = events.lead_id
        AND (public.has_role(auth.uid(),'admin') OR l.assigned_to = auth.uid() OR l.assigned_to IS NULL)
    )
  );
CREATE POLICY "events_insert_authed" ON public.events
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- 14. handle_new_user trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data ->> 'phone'
  );
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'manager');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 15. Lead stage change trigger → history + event
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_lead_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO public.lead_status_history (lead_id, from_stage_id, to_stage_id, changed_by)
    VALUES (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());

    INSERT INTO public.events (lead_id, event_type, payload, actor_id)
    VALUES (NEW.id, 'stage_changed',
      jsonb_build_object('from', OLD.stage_id, 'to', NEW.stage_id),
      auth.uid());

    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_leads_stage_change
BEFORE UPDATE OF stage_id ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.on_lead_stage_change();

-- Lead created event
CREATE OR REPLACE FUNCTION public.on_lead_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.lead_status_history (lead_id, from_stage_id, to_stage_id, changed_by)
  VALUES (NEW.id, NULL, NEW.stage_id, NEW.created_by);

  INSERT INTO public.events (lead_id, event_type, payload, actor_id)
  VALUES (NEW.id, 'created',
    jsonb_build_object('source', NEW.source, 'amount', NEW.amount),
    NEW.created_by);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_leads_created
AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.on_lead_created();

-- Communication → update last_contact_at + event + first_response_at
CREATE OR REPLACE FUNCTION public.on_communication_inserted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.leads
  SET last_contact_at = NEW.created_at,
      last_activity_at = NEW.created_at,
      first_response_at = COALESCE(first_response_at,
        CASE WHEN NEW.direction = 'out' AND NEW.is_draft = false THEN NEW.created_at ELSE NULL END)
  WHERE id = NEW.lead_id;

  INSERT INTO public.events (lead_id, event_type, payload, actor_id)
  VALUES (NEW.lead_id,
    CASE WHEN NEW.type = 'call' THEN 'call_made' ELSE 'message_sent' END,
    jsonb_build_object('direction', NEW.direction, 'channel', NEW.channel, 'is_draft', NEW.is_draft),
    NEW.created_by);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_comm_inserted
AFTER INSERT ON public.communications
FOR EACH ROW EXECUTE FUNCTION public.on_communication_inserted();

-- Deal paid → event + lead.paid
CREATE OR REPLACE FUNCTION public.on_deal_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status <> 'paid') THEN
    UPDATE public.leads
    SET paid = true,
        paid_at = COALESCE(NEW.paid_at, now()),
        payment_method = NEW.payment_method,
        amount = GREATEST(amount, NEW.amount),
        last_activity_at = now()
    WHERE id = NEW.lead_id;

    INSERT INTO public.events (lead_id, event_type, payload, actor_id)
    VALUES (NEW.lead_id, 'paid',
      jsonb_build_object('amount', NEW.amount, 'method', NEW.payment_method),
      auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_deal_change
AFTER INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.on_deal_change();

-- ============================================================
-- 16. SEED DATA: default pipeline + stages + loss reasons
-- ============================================================
INSERT INTO public.pipelines (id, name, is_default)
VALUES ('00000000-0000-0000-0000-000000000001', 'Основная воронка', true);

INSERT INTO public.pipeline_stages (pipeline_id, key, title, order_index, color, icon, is_terminal) VALUES
  ('00000000-0000-0000-0000-000000000001', 'new',         'Новый лид',     1, 'primary', 'zap',      false),
  ('00000000-0000-0000-0000-000000000001', 'no_answer',   'Без ответа',    2, 'warning', 'bell',     false),
  ('00000000-0000-0000-0000-000000000001', 'in_progress', 'В работе',      3, 'primary', 'message',  false),
  ('00000000-0000-0000-0000-000000000001', 'invoice',     'Счёт выставлен',4, 'accent',  'card',     false),
  ('00000000-0000-0000-0000-000000000001', 'scheduled',   'Запись на визит',5,'primary', 'calendar', false),
  ('00000000-0000-0000-0000-000000000001', 'visit',       'Визит',         6, 'success', 'map',      false),
  ('00000000-0000-0000-0000-000000000001', 'paid',        'Оплачено',      7, 'success', 'check',    true),
  ('00000000-0000-0000-0000-000000000001', 'rejected',    'Отказ',         8, 'destructive','ban',   true);

INSERT INTO public.loss_reasons (key, label, emoji, order_index) VALUES
  ('expensive',    'Дорого',             '💸', 1),
  ('no_contact',   'Не дозвонились',     '📵', 2),
  ('changed_mind', 'Передумал',          '🤔', 3),
  ('competitor',   'Ушёл к конкуренту',  '🏃', 4),
  ('other',        'Другое',             '❓', 5);

-- ============================================================
-- 17. Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.communications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;

ALTER TABLE public.leads REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.communications REPLICA IDENTITY FULL;
ALTER TABLE public.deals REPLICA IDENTITY FULL;

-- ============================================================
-- 18. Enable required extensions for cron jobs (later)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;