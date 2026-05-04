
ALTER TABLE public.ad_campaigns ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.cabinet_daily_insights ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS project_id uuid;

CREATE INDEX IF NOT EXISTS idx_cdi_project_date ON public.cabinet_daily_insights (project_id, date);
CREATE INDEX IF NOT EXISTS idx_leads_project_created ON public.leads (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_project_created ON public.ad_campaigns (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_cabinets_project ON public.ad_cabinets (project_id);
