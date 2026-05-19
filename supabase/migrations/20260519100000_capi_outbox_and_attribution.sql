-- ============================================================
-- Сквозная атрибуция: креатив → лид → этап CRM → CAPI
--
-- Этот файл закрывает три разрыва, мешавших end-to-end pipeline:
--   1. Нет таблицы для надёжной асинхронной отправки CAPI событий
--      (события могли теряться при сетевых ошибках / истёкших токенах).
--   2. Триггер с CRM не вызывал CAPI автоматически — отправка была
--      завязана на ручной вызов с фронта или отдельный n8n воркфлоу,
--      который смотрел в другой Supabase.
--   3. View meta_creative_crm_daily не учитывал manual_revenue → суммы
--      в воронке креативов отличались от Dashboard.totals.revenue.
-- ============================================================

-- 1) crm_stage_map — настраиваемое сопоставление CRM-стадии в CAPI событие.
--    Имена стадий локализованы (русские варианты, английские, любые), поэтому
--    хардкодить нельзя — пусть лежит в БД и расширяется без деплоя.
CREATE TABLE IF NOT EXISTS public.crm_stage_map (
  status_key text PRIMARY KEY,
  capi_event text NOT NULL CHECK (capi_event IN ('Lead', 'Schedule', 'Diagnostic', 'Purchase')),
  is_paid boolean NOT NULL DEFAULT false,
  -- Опциональный фильтр: правило применяется только к этому проекту. NULL = глобально.
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_stage_map ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_stage_map' AND policyname='stage_map_select_authed') THEN
    CREATE POLICY "stage_map_select_authed" ON public.crm_stage_map FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_stage_map' AND policyname='stage_map_admin_all') THEN
    CREATE POLICY "stage_map_admin_all" ON public.crm_stage_map FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
END $$;

-- Seed основных вариантов. Project_id = NULL = применяется ко всем проектам.
-- Если у клиента нестандартное имя стадии — admin добавляет строку через UI/SQL.
INSERT INTO public.crm_stage_map (status_key, capi_event, is_paid) VALUES
  -- Записан / Запись / Счёт (английские и русские)
  ('scheduled',         'Schedule',    false),
  ('booked',            'Schedule',    false),
  ('schedule',          'Schedule',    false),
  ('invoice',           'Schedule',    false),
  ('записан',           'Schedule',    false),
  ('запись',            'Schedule',    false),
  ('счёт',              'Schedule',    false),
  ('счет',              'Schedule',    false),
  -- Диагностика / Визит
  ('diagnostic',        'Diagnostic',  false),
  ('diagnosed',         'Diagnostic',  false),
  ('visit',             'Diagnostic',  false),
  ('диагностика',       'Diagnostic',  false),
  ('диагностирован',    'Diagnostic',  false),
  ('визит',             'Diagnostic',  false),
  ('диагност',          'Diagnostic',  false),
  -- Оплачено / Продажа
  ('paid',              'Purchase',    true),
  ('purchase',          'Purchase',    true),
  ('won',               'Purchase',    true),
  ('closed_won',        'Purchase',    true),
  ('sold',              'Purchase',    true),
  ('sale',              'Purchase',    true),
  ('completed',         'Purchase',    true),
  ('оплачен',           'Purchase',    true),
  ('оплачено',          'Purchase',    true),
  ('оплата',            'Purchase',    true),
  ('продажа',           'Purchase',    true),
  ('продано',           'Purchase',    true)
ON CONFLICT (status_key) DO NOTHING;

-- 2) capi_outbox — асинхронная очередь событий CAPI.
--    Триггеры на leads / deals пишут сюда строку при смене стадии. Воркер
--    (edge function capi-outbox-worker) читает pending, шлёт в Meta, обновляет статус.
--    UNIQUE индекс обеспечивает идемпотентность — повторная смена в ту же стадию
--    не создаст дубликат события.
CREATE TABLE IF NOT EXISTS public.capi_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  cabinet_id uuid REFERENCES public.ad_cabinets(id) ON DELETE SET NULL,
  -- 'Lead' | 'Schedule' | 'Diagnostic' | 'Purchase'. Стандартные Meta события +
  -- 'Diagnostic' — custom event (создаётся один раз в Meta Events Manager).
  event_name text NOT NULL,
  -- Детерминированный event_id для дедупликации с Pixel-событием на лендинге.
  -- Формат: '<lead_id>-<event_name>' — повторная отправка из любого источника
  -- не создаст дубль в счётчиках Meta.
  event_id text NOT NULL,
  event_time timestamptz NOT NULL DEFAULT now(),
  -- Атрибуция Meta — копируется из leads на момент создания записи, чтобы
  -- сохранить связь с креативом даже если лид потом отвяжут от кабинета.
  meta_ad_id text,
  meta_adset_id text,
  meta_campaign_id text,
  -- Деньги для Purchase события. KZT по умолчанию (из projects.currency).
  value numeric,
  currency text,
  -- Пользовательские данные для matching в Meta. Сохраняем сырыми; воркер хеширует
  -- перед отправкой (Meta требует SHA-256 нижним регистром).
  raw_user_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Жизненный цикл: pending → sent | failed (с повторами в attempts).
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  fb_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  -- (lead, event, event_id) уникален → at-most-once отправка одного логического события.
  UNIQUE(lead_id, event_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_capi_outbox_pending
  ON public.capi_outbox (status, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_capi_outbox_project_created
  ON public.capi_outbox (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_outbox_lead
  ON public.capi_outbox (lead_id, event_name);

ALTER TABLE public.capi_outbox ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='capi_outbox' AND policyname='capi_outbox_select_authed') THEN
    CREATE POLICY "capi_outbox_select_authed" ON public.capi_outbox FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='capi_outbox' AND policyname='capi_outbox_admin_all') THEN
    CREATE POLICY "capi_outbox_admin_all" ON public.capi_outbox FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
  END IF;
END $$;

-- 3) enqueue_capi_event — внутренняя функция, которую вызывают триггеры.
--    Резолвит проект → валюту, формирует event_id, аккуратно вставляет (idempotent).
CREATE OR REPLACE FUNCTION public.enqueue_capi_event(
  _lead_id uuid,
  _event_name text,
  _is_paid boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lead record;
  _currency text;
  _event_id text;
  _outbox_id uuid;
BEGIN
  IF _lead_id IS NULL OR _event_name IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _lead FROM public.leads WHERE id = _lead_id;
  IF _lead IS NULL THEN RETURN NULL; END IF;

  -- Currency: projects.currency хранит символ ('₸', '$') — конвертим в ISO для Meta.
  SELECT CASE
    WHEN p.currency IN ('₸', 'KZT') THEN 'KZT'
    WHEN p.currency IN ('$', 'USD') THEN 'USD'
    WHEN p.currency IN ('₽', 'RUB') THEN 'RUB'
    WHEN p.currency IN ('€', 'EUR') THEN 'EUR'
    ELSE COALESCE(p.currency, 'KZT')
  END INTO _currency FROM public.projects p WHERE p.id = _lead.project_id;

  _event_id := _lead.id::text || '-' || _event_name;

  INSERT INTO public.capi_outbox (
    lead_id, project_id, cabinet_id,
    event_name, event_id, event_time,
    meta_ad_id, meta_adset_id, meta_campaign_id,
    value, currency,
    raw_user_data,
    status
  ) VALUES (
    _lead.id, _lead.project_id, _lead.cabinet_id,
    _event_name, _event_id, now(),
    _lead.meta_ad_id, _lead.meta_adset_id, _lead.meta_campaign_id,
    CASE WHEN _is_paid THEN COALESCE(_lead.amount, 0) ELSE NULL END,
    COALESCE(_currency, 'KZT'),
    jsonb_build_object(
      'phone', _lead.phone,
      'email', _lead.email,
      'name', _lead.name,
      'fbc', _lead.click_id,
      'fbp', NULLIF(_lead.utm->>'fbp', ''),
      'external_id', _lead.id::text
    ),
    'pending'
  )
  ON CONFLICT (lead_id, event_name, event_id) DO NOTHING
  RETURNING id INTO _outbox_id;

  RETURN _outbox_id;
END;
$$;

-- 4) Триггер на смену стадии лида.
--    Слушает leads.stage_id; через JOIN с pipeline_stages → status_key → crm_stage_map → capi_event.
--    Так логика работает в любом проекте с любым именем стадии.
CREATE OR REPLACE FUNCTION public.on_lead_stage_change_capi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _stage_key text;
  _map record;
BEGIN
  -- Только при реальной смене стадии. INSERT-лиды тоже триггерят (если уже в нужной).
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;
  IF NEW.stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT key INTO _stage_key FROM public.pipeline_stages WHERE id = NEW.stage_id;
  IF _stage_key IS NULL THEN RETURN NEW; END IF;

  SELECT capi_event, is_paid INTO _map
    FROM public.crm_stage_map
    WHERE status_key = LOWER(TRIM(_stage_key))
      AND (project_id IS NULL OR project_id = NEW.project_id)
    ORDER BY project_id NULLS LAST  -- project-specific override побеждает
    LIMIT 1;

  IF _map.capi_event IS NULL THEN RETURN NEW; END IF;

  PERFORM public.enqueue_capi_event(NEW.id, _map.capi_event, _map.is_paid);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_stage_capi ON public.leads;
CREATE TRIGGER leads_stage_capi
  AFTER INSERT OR UPDATE OF stage_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.on_lead_stage_change_capi();

-- 5) Триггер на оплату сделки: deal.status='paid' → Purchase event с amount.
--    Дублирует логику триггера выше для случаев, когда оплата приходит через deals,
--    а не через смену leads.stage_id. enqueue_capi_event идемпотентен — дублей не будет.
CREATE OR REPLACE FUNCTION public.on_deal_paid_capi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid' OR TG_OP = 'INSERT') THEN
    PERFORM public.enqueue_capi_event(NEW.lead_id, 'Purchase', true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_paid_capi ON public.deals;
CREATE TRIGGER deals_paid_capi
  AFTER INSERT OR UPDATE OF status, paid_at, amount ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.on_deal_paid_capi();

-- 6) View meta_creative_crm_daily: добавляем учёт manual_revenue.
--    Раньше view брал только crm_revenue (от триггера on_deal_paid_attribution),
--    игнорируя ручной ввод в Таблице показателей. Из-за этого Топ-креативов
--    показывал одну сумму, а Dashboard.totals.revenue — другую.
--    Override-aware версия: для каждого дня кабинета берём max(crm_revenue, manual_revenue).
DROP VIEW IF EXISTS public.meta_creative_crm_daily;
CREATE VIEW public.meta_creative_crm_daily WITH (security_invoker=true) AS
WITH lead_days AS (
  SELECT
    l.meta_ad_id AS ad_id,
    l.project_id,
    l.cabinet_id,
    (l.created_at AT TIME ZONE 'Asia/Almaty')::date AS date,
    COUNT(*)::int AS crm_leads,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.pipeline_stages ps
      WHERE ps.id = l.stage_id AND ps.is_diagnostic = true
    ))::int AS crm_qualified
  FROM public.leads l
  WHERE l.meta_ad_id IS NOT NULL
  GROUP BY l.meta_ad_id, l.project_id, l.cabinet_id, ((l.created_at AT TIME ZONE 'Asia/Almaty')::date)
),
sale_rows AS (
  -- Продажи через deals (стандартный путь)
  SELECT l.meta_ad_id AS ad_id, l.project_id, l.cabinet_id,
         (COALESCE(d.paid_at, d.updated_at) AT TIME ZONE 'Asia/Almaty')::date AS date,
         1 AS crm_sales, COALESCE(d.amount, 0)::numeric AS crm_revenue
  FROM public.deals d
  JOIN public.leads l ON l.id = d.lead_id
  WHERE d.status = 'paid' AND l.meta_ad_id IS NOT NULL
  UNION ALL
  -- Fallback: leads.paid=true без deal-строки
  SELECT l.meta_ad_id, l.project_id, l.cabinet_id,
         (COALESCE(l.paid_at, l.updated_at) AT TIME ZONE 'Asia/Almaty')::date,
         1, COALESCE(l.amount, 0)::numeric
  FROM public.leads l
  WHERE l.paid = true
    AND l.meta_ad_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.deals d2
      WHERE d2.lead_id = l.id AND d2.status = 'paid'
    )
),
sale_days AS (
  SELECT ad_id, project_id, cabinet_id, date,
         SUM(crm_sales)::int AS crm_sales,
         SUM(crm_revenue)::numeric AS crm_revenue
  FROM sale_rows
  GROUP BY ad_id, project_id, cabinet_id, date
),
-- Override из cabinet_daily_insights: если на день+кабинет введён ручной факт,
-- он перезаписывает crm_revenue (та же override-семантика, что в Metrics.tsx).
manual_overrides AS (
  SELECT cabinet_id, date,
         SUM(GREATEST(manual_revenue, 0))::numeric AS manual_revenue_total,
         SUM(GREATEST(manual_sales, 0))::int AS manual_sales_total
  FROM public.cabinet_daily_insights
  WHERE manual_revenue > 0 OR manual_sales > 0
  GROUP BY cabinet_id, date
)
SELECT
  COALESCE(ld.ad_id, sd.ad_id) AS ad_id,
  COALESCE(ld.project_id, sd.project_id) AS project_id,
  COALESCE(ld.cabinet_id, sd.cabinet_id) AS cabinet_id,
  COALESCE(ld.date, sd.date) AS date,
  COALESCE(ld.crm_leads, 0) AS crm_leads,
  COALESCE(ld.crm_qualified, 0) AS crm_qualified,
  -- Override: manual > 0 ? manual : crm (как в useMetaInsights/useReportData)
  CASE
    WHEN mo.manual_sales_total > 0 THEN mo.manual_sales_total
    ELSE COALESCE(sd.crm_sales, 0)
  END AS crm_sales,
  CASE
    WHEN mo.manual_revenue_total > 0 THEN mo.manual_revenue_total
    ELSE COALESCE(sd.crm_revenue, 0::numeric)
  END AS crm_revenue
FROM lead_days ld
FULL JOIN sale_days sd
  ON ld.ad_id = sd.ad_id
  AND ld.project_id IS NOT DISTINCT FROM sd.project_id
  AND ld.date = sd.date
LEFT JOIN manual_overrides mo
  ON mo.cabinet_id = COALESCE(ld.cabinet_id, sd.cabinet_id)
  AND mo.date = COALESCE(ld.date, sd.date);

GRANT SELECT ON public.meta_creative_crm_daily TO authenticated;

-- 7) Realtime для capi_outbox: фронт видит статус отправки в реальном времени.
ALTER TABLE public.capi_outbox REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='capi_outbox'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.capi_outbox';
  END IF;
END $$;

-- 8) Бэкфилл: для всех уже оплаченных сделок без CAPI-записи создаём pending.
--    Воркер их разошлёт — Meta дедупит по event_id, если они уже были отправлены ранее.
INSERT INTO public.capi_outbox (lead_id, project_id, cabinet_id, event_name, event_id, event_time,
                                 meta_ad_id, meta_adset_id, meta_campaign_id,
                                 value, currency, raw_user_data, status)
SELECT
  l.id, l.project_id, l.cabinet_id,
  'Purchase', l.id::text || '-Purchase',
  COALESCE(l.paid_at, l.updated_at, l.created_at),
  l.meta_ad_id, l.meta_adset_id, l.meta_campaign_id,
  COALESCE(l.amount, 0),
  CASE
    WHEN p.currency IN ('₸', 'KZT') THEN 'KZT'
    WHEN p.currency IN ('$', 'USD') THEN 'USD'
    ELSE COALESCE(p.currency, 'KZT')
  END,
  jsonb_build_object('phone', l.phone, 'email', l.email, 'name', l.name,
                     'fbc', l.click_id, 'external_id', l.id::text),
  'pending'
FROM public.leads l
LEFT JOIN public.projects p ON p.id = l.project_id
WHERE l.paid = true
  AND l.meta_ad_id IS NOT NULL
ON CONFLICT (lead_id, event_name, event_id) DO NOTHING;
