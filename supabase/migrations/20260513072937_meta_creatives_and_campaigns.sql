-- ============================================================
-- Пакеты 3 + 4. Meta Ads: креативы и кампании по целям
-- ============================================================
-- Пакет 3: meta_creatives + meta_creative_daily — превью и аналитика
--   каждого креатива (image / video / carousel).
-- Пакет 4: meta_campaigns + meta_campaign_daily — кампании с objective
--   (LEADS / MESSAGES / OUTCOME_LEADS / OUTCOME_TRAFFIC и т.п.)
--   и destination_type (WHATSAPP / MESSENGER / WEBSITE).
-- ============================================================

-- ---------- 1. meta_campaigns ----------
CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  campaign_id      text NOT NULL,                       -- Meta campaign id
  name             text NOT NULL,
  objective        text,                                -- e.g. LEAD_GENERATION, OUTCOME_LEADS, MESSAGES
  destination_type text,                                -- WHATSAPP / MESSENGER / WEBSITE / UNDEFINED
  status           text,                                -- ACTIVE / PAUSED / ARCHIVED ...
  effective_status text,
  daily_budget     numeric,
  lifetime_budget  numeric,
  start_time       timestamptz,
  stop_time        timestamptz,
  last_synced_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_cabinet      ON public.meta_campaigns(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_project      ON public.meta_campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_objective    ON public.meta_campaigns(objective);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_destination  ON public.meta_campaigns(destination_type);

ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_campaigns_select_authed ON public.meta_campaigns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY meta_campaigns_write_admin ON public.meta_campaigns
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------- 2. meta_campaign_daily ----------
CREATE TABLE IF NOT EXISTS public.meta_campaign_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   text NOT NULL,
  cabinet_id    uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  date          date NOT NULL,
  spend         numeric NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  leads         integer NOT NULL DEFAULT 0,
  messages      integer NOT NULL DEFAULT 0,             -- начатые переписки
  purchases     integer NOT NULL DEFAULT 0,
  revenue       numeric NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'KZT',
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_daily_date  ON public.meta_campaign_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_campaign_daily_cab   ON public.meta_campaign_daily(cabinet_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_campaign_daily_proj  ON public.meta_campaign_daily(project_id, date DESC);

ALTER TABLE public.meta_campaign_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_campaign_daily REPLICA IDENTITY FULL;
CREATE POLICY mcd_select_authed ON public.meta_campaign_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY mcd_write_admin ON public.meta_campaign_daily
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------- 3. meta_creatives ----------
CREATE TABLE IF NOT EXISTS public.meta_creatives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ad_id           text NOT NULL,
  adset_id        text,
  campaign_id     text,
  name            text NOT NULL,
  status          text,                                  -- ACTIVE / PAUSED
  effective_status text,
  creative_type   text NOT NULL DEFAULT 'image',         -- image | video | carousel | dynamic
  thumbnail_url   text,
  image_url       text,
  video_id        text,
  video_url       text,
  primary_text    text,
  headline        text,
  cta             text,
  destination_url text,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_creatives_cabinet     ON public.meta_creatives(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_meta_creatives_project     ON public.meta_creatives(project_id);
CREATE INDEX IF NOT EXISTS idx_meta_creatives_campaign    ON public.meta_creatives(campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_creatives_status      ON public.meta_creatives(effective_status);

ALTER TABLE public.meta_creatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_creatives_select_authed ON public.meta_creatives
  FOR SELECT TO authenticated USING (true);
CREATE POLICY meta_creatives_write_admin ON public.meta_creatives
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------- 4. meta_creative_daily ----------
CREATE TABLE IF NOT EXISTS public.meta_creative_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id         text NOT NULL,
  cabinet_id    uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  campaign_id   text,
  date          date NOT NULL,
  spend         numeric NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  clicks        integer NOT NULL DEFAULT 0,
  leads         integer NOT NULL DEFAULT 0,
  messages      integer NOT NULL DEFAULT 0,
  purchases     integer NOT NULL DEFAULT 0,
  revenue       numeric NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'KZT',
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_creative_daily_date ON public.meta_creative_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_creative_daily_cab  ON public.meta_creative_daily(cabinet_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_creative_daily_proj ON public.meta_creative_daily(project_id, date DESC);

ALTER TABLE public.meta_creative_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_creative_daily REPLICA IDENTITY FULL;
CREATE POLICY mcrd_select_authed ON public.meta_creative_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY mcrd_write_admin ON public.meta_creative_daily
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------- 5. View: креатив + агрегаты по периоду ----------
CREATE OR REPLACE VIEW public.meta_creative_overview AS
SELECT
  c.id,
  c.project_id,
  c.cabinet_id,
  c.ad_id,
  c.campaign_id,
  c.name,
  c.creative_type,
  c.thumbnail_url,
  c.image_url,
  c.video_url,
  c.video_id,
  c.primary_text,
  c.headline,
  c.cta,
  c.destination_url,
  c.effective_status,
  c.last_synced_at,
  COALESCE(SUM(d.spend), 0)        AS spend_all,
  COALESCE(SUM(d.impressions), 0)  AS impressions_all,
  COALESCE(SUM(d.clicks), 0)       AS clicks_all,
  COALESCE(SUM(d.leads), 0)        AS leads_all,
  COALESCE(SUM(d.messages), 0)     AS messages_all,
  COALESCE(SUM(d.purchases), 0)    AS purchases_all,
  COALESCE(SUM(d.revenue), 0)      AS revenue_all,
  MAX(d.date)                      AS last_active_date
FROM public.meta_creatives c
LEFT JOIN public.meta_creative_daily d ON d.ad_id = c.ad_id
GROUP BY c.id;

COMMENT ON VIEW public.meta_creative_overview IS
  'Креативы Meta с агрегированными метриками за всё время — для аналитики креативов на дашборде.';

-- ---------- 6. View: кампании с агрегатами по objective/destination ----------
CREATE OR REPLACE VIEW public.meta_campaign_overview AS
SELECT
  c.id,
  c.project_id,
  c.cabinet_id,
  c.campaign_id,
  c.name,
  c.objective,
  c.destination_type,
  c.effective_status,
  c.status,
  c.daily_budget,
  c.last_synced_at,
  COALESCE(SUM(d.spend), 0)        AS spend_all,
  COALESCE(SUM(d.impressions), 0)  AS impressions_all,
  COALESCE(SUM(d.clicks), 0)       AS clicks_all,
  COALESCE(SUM(d.leads), 0)        AS leads_all,
  COALESCE(SUM(d.messages), 0)     AS messages_all,
  COALESCE(SUM(d.purchases), 0)    AS purchases_all,
  COALESCE(SUM(d.revenue), 0)      AS revenue_all
FROM public.meta_campaigns c
LEFT JOIN public.meta_campaign_daily d ON d.campaign_id = c.campaign_id
GROUP BY c.id;

COMMENT ON VIEW public.meta_campaign_overview IS
  'Кампании Meta с агрегированными метриками — позволяет фильтровать KPI по цели (LEADS/MESSAGES/...) и месту назначения (WHATSAPP/WEBSITE/...).';
