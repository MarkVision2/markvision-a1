-- ============================================================
-- Пакет 1. Multi-provider источники заявок + Instagram organic
-- ============================================================
-- 1) Колонка provider у ad_cabinets и cabinet_daily_insights:
--    meta | google | instagram_organic
-- 2) Таблицы для воронки Instagram organic:
--    instagram_codewords    — словарь активных код-слов на рилсы
--    instagram_organic_events — поток событий (DM / клик / заявка)
-- 3) View для дневной агрегации Instagram organic событий в формате
--    cabinet_daily_insights, чтобы дашборд видел источник единообразно.
-- ============================================================

-- 1. provider columns ---------------------------------------------------
ALTER TABLE public.ad_cabinets
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta';

ALTER TABLE public.cabinet_daily_insights
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta';

CREATE INDEX IF NOT EXISTS idx_ad_cabinets_provider
  ON public.ad_cabinets(provider);

CREATE INDEX IF NOT EXISTS idx_cdi_provider_date
  ON public.cabinet_daily_insights(provider, date DESC);

COMMENT ON COLUMN public.ad_cabinets.provider IS
  'meta | google | instagram_organic — источник данных рекламы.';

-- 2. instagram_codewords ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.instagram_codewords (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  codeword      text NOT NULL,
  reel_id       text,
  reel_url      text,
  thumbnail_url text,
  caption       text,
  published_at  timestamptz,
  target_url    text,
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, codeword)
);

CREATE INDEX IF NOT EXISTS idx_ig_codewords_project_active
  ON public.instagram_codewords(project_id, active);

ALTER TABLE public.instagram_codewords ENABLE ROW LEVEL SECURITY;

CREATE POLICY ig_codewords_select_authed
  ON public.instagram_codewords
  FOR SELECT TO authenticated USING (true);

CREATE POLICY ig_codewords_write_admin
  ON public.instagram_codewords
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_ig_codewords_updated
  BEFORE UPDATE ON public.instagram_codewords
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. instagram_organic_events ------------------------------------------
CREATE TABLE IF NOT EXISTS public.instagram_organic_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  codeword_id  uuid REFERENCES public.instagram_codewords(id) ON DELETE SET NULL,
  -- кэшируем code-word/reel в строке — даже если родительский словарь удалят, аналитика не сломается
  codeword     text,
  reel_id      text,
  reel_url     text,
  event_type   text NOT NULL CHECK (event_type IN ('codeword_dm', 'link_click', 'lead')),
  username     text,
  contact      text,
  lead_id      uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  date         date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Almaty')::date,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ig_events_project_date
  ON public.instagram_organic_events(project_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_ig_events_codeword_date
  ON public.instagram_organic_events(codeword_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_ig_events_type
  ON public.instagram_organic_events(event_type, date DESC);

-- Реалтайм: при добавлении событий дашборд тут же обновится.
ALTER TABLE public.instagram_organic_events REPLICA IDENTITY FULL;

ALTER TABLE public.instagram_organic_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ig_events_select_authed
  ON public.instagram_organic_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY ig_events_insert_admin
  ON public.instagram_organic_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY ig_events_update_admin
  ON public.instagram_organic_events
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY ig_events_delete_admin
  ON public.instagram_organic_events
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. Аналитическая view: дневная воронка Instagram organic ---------------
CREATE OR REPLACE VIEW public.instagram_organic_daily AS
SELECT
  project_id,
  date,
  COUNT(*) FILTER (WHERE event_type = 'codeword_dm')                          AS codeword_dms,
  COUNT(DISTINCT username) FILTER (WHERE event_type = 'codeword_dm')          AS unique_codeword_users,
  COUNT(*) FILTER (WHERE event_type = 'link_click')                            AS link_clicks,
  COUNT(*) FILTER (WHERE event_type = 'lead')                                  AS leads
FROM public.instagram_organic_events
WHERE project_id IS NOT NULL
GROUP BY project_id, date;

COMMENT ON VIEW public.instagram_organic_daily IS
  'Дневная воронка Instagram organic: DM с код-словом → переход по ссылке → заявка.';

-- 5. Breakdown по код-словам (для аналитики "какой рилс приносит") --------
CREATE OR REPLACE VIEW public.instagram_codeword_stats AS
SELECT
  w.id           AS codeword_id,
  w.project_id,
  w.codeword,
  w.reel_url,
  w.thumbnail_url,
  w.active,
  COUNT(e.*) FILTER (WHERE e.event_type = 'codeword_dm')         AS codeword_dms,
  COUNT(e.*) FILTER (WHERE e.event_type = 'link_click')          AS link_clicks,
  COUNT(e.*) FILTER (WHERE e.event_type = 'lead')                AS leads,
  MAX(e.occurred_at)                                             AS last_event_at
FROM public.instagram_codewords w
LEFT JOIN public.instagram_organic_events e
  ON e.codeword_id = w.id
GROUP BY w.id, w.project_id, w.codeword, w.reel_url, w.thumbnail_url, w.active;

COMMENT ON VIEW public.instagram_codeword_stats IS
  'Статистика по каждому код-слову: сколько DM, сколько кликов, сколько заявок.';
