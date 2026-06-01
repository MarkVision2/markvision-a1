-- ============================================================
-- Content Analytics — сквозная аналитика органического контента.
--
-- Дополняет существующий пакет Instagram organic:
--   1) instagram_codewords.short_id — публичный short-link идентификатор
--      для редиректа (формат: 8 url-safe символов, генерируется триггером).
--   2) RLS — открываем CRUD на код-слова и события для всех участников
--      проекта (через user_can_access_project), а не только для admin.
--      Раньше только admin мог завести код-слово из UI — это блокировало
--      product/marketing-команды.
--   3) view instagram_codeword_stats полностью переписан: теперь возвращает
--      sales и revenue по leads (paid=true) + unique_users по DM.
--   4) view instagram_reel_daily — дневная разбивка по рилсам (для графика
--      "какой рилс приносит лиды").
--   5) helper resolve_codeword_short(short text) — для edge-функции редиректа.
-- ============================================================

-- 1) short_id на code-words --------------------------------------------------

-- URL-safe 8-символьный slug (~48 бит — для публичных code-word ссылок
-- этого достаточно: коллизия проверяется UNIQUE-индексом).
CREATE OR REPLACE FUNCTION public.gen_codeword_short_id()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT substring(translate(encode(gen_random_bytes(6), 'base64'), '+/=', '-_x') from 1 for 8)
$$;

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS short_id text;

-- Backfill: всем существующим code-words проставляем short_id.
DO $$
DECLARE
  r record;
  v_short text;
BEGIN
  FOR r IN SELECT id FROM public.instagram_codewords WHERE short_id IS NULL LOOP
    LOOP
      v_short := public.gen_codeword_short_id();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.instagram_codewords WHERE short_id = v_short);
    END LOOP;
    UPDATE public.instagram_codewords SET short_id = v_short WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.instagram_codewords
  ALTER COLUMN short_id SET NOT NULL,
  ALTER COLUMN short_id SET DEFAULT public.gen_codeword_short_id();

CREATE UNIQUE INDEX IF NOT EXISTS instagram_codewords_short_id_key
  ON public.instagram_codewords(short_id);

COMMENT ON COLUMN public.instagram_codewords.short_id IS
  'URL-safe slug для редирект-ссылки (/functions/v1/ig-organic-redirect?c=<short_id>).';

-- 2) RLS: открываем код-слова и события участникам проекта -------------------

-- Удаляем старые admin-only policy и заменяем на project-scoped.
DROP POLICY IF EXISTS ig_codewords_select_authed   ON public.instagram_codewords;
DROP POLICY IF EXISTS ig_codewords_write_admin     ON public.instagram_codewords;

CREATE POLICY ig_codewords_select_member
  ON public.instagram_codewords
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_codewords_insert_member
  ON public.instagram_codewords
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_codewords_update_member
  ON public.instagram_codewords
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_codewords_delete_member
  ON public.instagram_codewords
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

DROP POLICY IF EXISTS ig_events_select_authed  ON public.instagram_organic_events;
DROP POLICY IF EXISTS ig_events_insert_admin   ON public.instagram_organic_events;
DROP POLICY IF EXISTS ig_events_update_admin   ON public.instagram_organic_events;
DROP POLICY IF EXISTS ig_events_delete_admin   ON public.instagram_organic_events;

CREATE POLICY ig_events_select_member
  ON public.instagram_organic_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_events_insert_member
  ON public.instagram_organic_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_events_update_member
  ON public.instagram_organic_events
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_events_delete_member
  ON public.instagram_organic_events
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

-- 3) Обогащённый view: stats по код-словам с продажами и выручкой ------------
DROP VIEW IF EXISTS public.instagram_codeword_stats;

CREATE VIEW public.instagram_codeword_stats AS
WITH ev AS (
  SELECT
    e.codeword_id,
    COUNT(*) FILTER (WHERE e.event_type = 'codeword_dm')                                              AS codeword_dms,
    COUNT(DISTINCT e.username) FILTER (WHERE e.event_type = 'codeword_dm' AND e.username IS NOT NULL) AS unique_users,
    COUNT(*) FILTER (WHERE e.event_type = 'link_click')                                               AS link_clicks,
    COUNT(*) FILTER (WHERE e.event_type = 'lead')                                                     AS leads,
    MAX(e.occurred_at)                                                                                AS last_event_at,
    array_remove(array_agg(DISTINCT e.lead_id) FILTER (WHERE e.lead_id IS NOT NULL), NULL)            AS lead_ids
  FROM public.instagram_organic_events e
  WHERE e.codeword_id IS NOT NULL
  GROUP BY e.codeword_id
),
sales AS (
  SELECT
    ev.codeword_id,
    COUNT(*) FILTER (WHERE l.paid)                                       AS sales,
    COALESCE(SUM(l.amount) FILTER (WHERE l.paid), 0)::numeric             AS revenue
  FROM ev
  LEFT JOIN public.leads l ON l.id = ANY(ev.lead_ids)
  GROUP BY ev.codeword_id
)
SELECT
  w.id                                  AS codeword_id,
  w.project_id,
  w.codeword,
  w.short_id,
  w.reel_url,
  w.thumbnail_url,
  w.target_url,
  w.active,
  w.published_at,
  w.created_at,
  COALESCE(ev.codeword_dms, 0)::int     AS codeword_dms,
  COALESCE(ev.unique_users, 0)::int     AS unique_users,
  COALESCE(ev.link_clicks, 0)::int      AS link_clicks,
  COALESCE(ev.leads, 0)::int            AS leads,
  COALESCE(sales.sales, 0)::int         AS sales,
  COALESCE(sales.revenue, 0)::numeric   AS revenue,
  ev.last_event_at
FROM public.instagram_codewords w
LEFT JOIN ev    ON ev.codeword_id    = w.id
LEFT JOIN sales ON sales.codeword_id = w.id;

ALTER VIEW public.instagram_codeword_stats SET (security_invoker = true);

COMMENT ON VIEW public.instagram_codeword_stats IS
  'Per-codeword воронка: DM → клик → лид → продажа + выручка из leads.amount (paid=true).';

-- 4) View: дневная разбивка по рилсам ----------------------------------------
DROP VIEW IF EXISTS public.instagram_reel_daily;

CREATE VIEW public.instagram_reel_daily AS
SELECT
  e.project_id,
  e.date,
  e.codeword_id,
  e.codeword,
  e.reel_url,
  e.reel_id,
  COUNT(*) FILTER (WHERE e.event_type = 'codeword_dm')             AS codeword_dms,
  COUNT(*) FILTER (WHERE e.event_type = 'link_click')              AS link_clicks,
  COUNT(*) FILTER (WHERE e.event_type = 'lead')                    AS leads
FROM public.instagram_organic_events e
WHERE e.project_id IS NOT NULL
GROUP BY e.project_id, e.date, e.codeword_id, e.codeword, e.reel_url, e.reel_id;

ALTER VIEW public.instagram_reel_daily SET (security_invoker = true);

COMMENT ON VIEW public.instagram_reel_daily IS
  'Дневная воронка per-reel — для графика "какой рилс приносит лиды".';

-- 5) Helper для edge-функции редиректа: short_id → code-word строка ----------
CREATE OR REPLACE FUNCTION public.resolve_codeword_short(p_short text)
RETURNS TABLE (
  id          uuid,
  project_id  uuid,
  codeword    text,
  target_url  text,
  reel_id     text,
  reel_url    text,
  active      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, project_id, codeword, target_url, reel_id, reel_url, active
  FROM public.instagram_codewords
  WHERE short_id = p_short
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.resolve_codeword_short(text) TO anon, authenticated, service_role;
