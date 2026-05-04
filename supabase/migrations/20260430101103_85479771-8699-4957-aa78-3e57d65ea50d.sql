
-- ============================================================
-- 1. РАСШИРИТЬ ENUM РОЛЕЙ
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'director' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'director';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'marketer' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'marketer';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'viewer' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'viewer';
  END IF;
END$$;

-- ============================================================
-- 2. ДОПОЛНИТЬ ПРОФИЛЬ
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login text,
  ADD COLUMN IF NOT EXISTS display_role text;

-- ============================================================
-- 3. ПРОЕКТЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  domain text,
  initials text NOT NULL DEFAULT 'PR',
  is_primary boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select_authed" ON public.projects
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_insert_authed" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "projects_update_owner_admin" ON public.projects
  FOR UPDATE TO authenticated USING (created_by = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "projects_delete_admin" ON public.projects
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- активный проект пользователя
CREATE TABLE IF NOT EXISTS public.user_active_project (
  user_id uuid NOT NULL PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_active_project ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uap_select_own" ON public.user_active_project
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "uap_upsert_own" ON public.user_active_project
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "uap_update_own" ON public.user_active_project
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "uap_delete_own" ON public.user_active_project
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- 4. РЕКЛАМНЫЕ КАБИНЕТЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ad_cabinets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  external_id text NOT NULL DEFAULT '',
  online boolean NOT NULL DEFAULT true,
  type text NOT NULL DEFAULT 'Личный',
  spend numeric NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  lead_cost numeric NOT NULL DEFAULT 0,
  sales integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_cabinets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ad_cabinets_select_authed" ON public.ad_cabinets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ad_cabinets_write_admin" ON public.ad_cabinets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ad_cabinets_updated BEFORE UPDATE ON public.ad_cabinets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  goal text NOT NULL DEFAULT '',
  budget text NOT NULL DEFAULT '',
  text text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ad_campaigns_select_authed" ON public.ad_campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ad_campaigns_write_admin" ON public.ad_campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 5. ФИНАНСЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.finance_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  spend numeric NOT NULL DEFAULT 0,
  leads numeric NOT NULL DEFAULT 0,
  cpl numeric NOT NULL DEFAULT 0,
  visits numeric NOT NULL DEFAULT 0,
  sales numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  avg_check numeric NOT NULL DEFAULT 0,
  cr_lead_visit numeric NOT NULL DEFAULT 0,
  cr_visit_sale numeric NOT NULL DEFAULT 0,
  saved_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, month_key)
);
ALTER TABLE public.finance_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance_plans_select_authed" ON public.finance_plans
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "finance_plans_write_admin" ON public.finance_plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_finance_plans_updated BEFORE UPDATE ON public.finance_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.monthly_finance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  revenue numeric NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, month_key)
);
ALTER TABLE public.monthly_finance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "monthly_finance_select_authed" ON public.monthly_finance
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "monthly_finance_write_admin" ON public.monthly_finance
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_monthly_finance_updated BEFORE UPDATE ON public.monthly_finance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.revenue_plan (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, month_key)
);
ALTER TABLE public.revenue_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY "revenue_plan_select_authed" ON public.revenue_plan
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "revenue_plan_write_admin" ON public.revenue_plan
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_revenue_plan_updated BEFORE UPDATE ON public.revenue_plan
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6. КЛИЕНТЫ АГЕНТСТВА
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agency_clients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  pay_date date,
  status text NOT NULL DEFAULT 'waiting',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agency_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_clients_admin_all" ON public.agency_clients
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_agency_clients_updated BEFORE UPDATE ON public.agency_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.agency_client_services (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.agency_clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agency_client_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_services_admin_all" ON public.agency_client_services
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 7. WHATSAPP И БЫСТРЫЕ ОТВЕТЫ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_config (
  user_id uuid NOT NULL PRIMARY KEY,
  connected boolean NOT NULL DEFAULT false,
  phone text,
  display_name text,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_select_own" ON public.whatsapp_config
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wa_insert_own" ON public.whatsapp_config
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "wa_update_own" ON public.whatsapp_config
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "wa_delete_own" ON public.whatsapp_config
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER trg_wa_updated BEFORE UPDATE ON public.whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.quick_replies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  text text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qr_select_own" ON public.quick_replies
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "qr_insert_own" ON public.quick_replies
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "qr_update_own" ON public.quick_replies
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "qr_delete_own" ON public.quick_replies
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- 8. МОДУЛЬНЫЕ ДОСТУПЫ СОТРУДНИКОВ
-- ============================================================
CREATE TABLE IF NOT EXISTS public.team_member_modules (
  user_id uuid NOT NULL,
  module_key text NOT NULL,
  PRIMARY KEY (user_id, module_key)
);
ALTER TABLE public.team_member_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tmm_select_own_or_admin" ON public.team_member_modules
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "tmm_write_admin" ON public.team_member_modules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 9. SEED: pipeline + стадии + причины отказа
-- ============================================================
DO $$
DECLARE
  v_pipeline_id uuid;
BEGIN
  SELECT id INTO v_pipeline_id FROM public.pipelines WHERE is_default = true LIMIT 1;
  IF v_pipeline_id IS NULL THEN
    INSERT INTO public.pipelines (name, is_default) VALUES ('Default', true) RETURNING id INTO v_pipeline_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE pipeline_id = v_pipeline_id) THEN
    INSERT INTO public.pipeline_stages (pipeline_id, key, title, color, icon, order_index, is_terminal) VALUES
      (v_pipeline_id, 'new',         'Новая',      'primary',     'zap',      0, false),
      (v_pipeline_id, 'no_answer',   'Без ответа', 'warning',     'bell',     1, false),
      (v_pipeline_id, 'in_progress', 'В работе',   'primary',     'message',  2, false),
      (v_pipeline_id, 'invoice',     'Счёт',       'warning',     'card',     3, false),
      (v_pipeline_id, 'scheduled',   'Записан',    'primary',     'calendar', 4, false),
      (v_pipeline_id, 'visit',       'Визит',      'success',     'map',      5, false),
      (v_pipeline_id, 'paid',        'Оплачен',    'success',     'check',    6, true),
      (v_pipeline_id, 'rejected',    'Отказ',      'destructive', 'ban',      7, true);
  END IF;
END$$;

INSERT INTO public.loss_reasons (key, label, emoji, order_index)
SELECT * FROM (VALUES
  ('expensive',    'Дорого',              '💸', 0),
  ('no_contact',   'Не дозвонились',      '📵', 1),
  ('changed_mind', 'Передумал',           '🤔', 2),
  ('competitor',   'Ушёл к конкуренту',   '🏃', 3),
  ('other',        'Другое',              '❓', 4)
) AS t(key,label,emoji,order_index)
WHERE NOT EXISTS (SELECT 1 FROM public.loss_reasons LIMIT 1);

-- ============================================================
-- 10. REALTIME: добавить таблицы в публикацию
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'leads','pipeline_stages','pipelines','communications','tasks','deals','events',
    'lead_status_history','automation_settings','loss_reasons',
    'projects','user_active_project','ad_cabinets','ad_campaigns',
    'finance_plans','monthly_finance','revenue_plan',
    'agency_clients','agency_client_services',
    'whatsapp_config','quick_replies','team_member_modules',
    'profiles','user_roles'
  ]) LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END$$;

-- индексы под частые запросы
CREATE INDEX IF NOT EXISTS idx_leads_stage_id ON public.leads(stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_communications_lead_id ON public.communications(lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_lead_id ON public.tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_events_lead_id ON public.events(lead_id);
CREATE INDEX IF NOT EXISTS idx_ad_cabinets_project_id ON public.ad_cabinets(project_id);
CREATE INDEX IF NOT EXISTS idx_finance_plans_project_id ON public.finance_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_monthly_finance_project_id ON public.monthly_finance(project_id);
