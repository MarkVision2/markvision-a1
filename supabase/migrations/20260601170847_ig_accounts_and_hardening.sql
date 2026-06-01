-- ============================================================
-- Instagram-аккаунты проекта + харднинг pipeline:
--   1) project_instagram_accounts — отдельный аккаунт IG, к которому
--      привязывается аналитика (handle, метаданные Meta-OAuth).
--      Пароли НЕ храним. Подключение идёт официальным путём (Meta Graph)
--      либо webhook-only (внешний бот шлёт события на наш intake).
--   2) ig_account_id на instagram_codewords + instagram_organic_events
--      (nullable — backward compatible).
--   3) Идемпотентность: external_event_id (UNIQUE per project) — повторные
--      webhook'и от n8n не дублируют события.
--   4) Late-attribution helper: функция, которая пытается заматчить лид
--      на код-слово по username/contact, если cw не пришёл явно.
--   5) Триггер: обновляем last_event_at на аккаунте при каждом событии.
-- ============================================================

-- 1) Таблица аккаунтов -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.project_instagram_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  handle            text NOT NULL CHECK (length(handle) BETWEEN 1 AND 60),
  display_name      text,
  avatar_url        text,

  -- Meta Graph API (при подключении через Facebook OAuth).
  -- Все эти поля опциональны: webhook-only режим работает без них.
  ig_user_id        text,
  ig_business_id    text,
  page_id           text,
  access_token      text,          -- маскируется в client responses на уровне политик
  token_expires_at  timestamptz,

  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'connected', 'error', 'expired', 'disconnected')),
  last_error        text,
  connected_at     timestamptz,
  last_event_at     timestamptz,

  notes             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Нормализуем handle: только нижний регистр, без @.
CREATE OR REPLACE FUNCTION public.normalize_ig_handle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.handle := lower(regexp_replace(coalesce(NEW.handle, ''), '^@', ''));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ig_account_normalize
  BEFORE INSERT OR UPDATE ON public.project_instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION public.normalize_ig_handle();

CREATE UNIQUE INDEX IF NOT EXISTS ig_accounts_project_handle_key
  ON public.project_instagram_accounts(project_id, handle);

CREATE INDEX IF NOT EXISTS ig_accounts_project_idx
  ON public.project_instagram_accounts(project_id);

ALTER TABLE public.project_instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ig_accounts_select_member
  ON public.project_instagram_accounts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_accounts_insert_member
  ON public.project_instagram_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_accounts_update_member
  ON public.project_instagram_accounts
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

CREATE POLICY ig_accounts_delete_member
  ON public.project_instagram_accounts
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.user_can_access_project(project_id)
  );

-- access_token не отдаём в обычные SELECT клиентам.
REVOKE SELECT (access_token) ON public.project_instagram_accounts FROM authenticated, anon;
GRANT  SELECT (access_token) ON public.project_instagram_accounts TO service_role;

COMMENT ON TABLE public.project_instagram_accounts IS
  'Привязка IG-аккаунтов к проекту. Аналитика органического контента группируется по аккаунту.';

COMMENT ON COLUMN public.project_instagram_accounts.access_token IS
  'Meta Graph long-lived token. Доступен только service_role.';

-- 2) FK на ig_account_id ----------------------------------------------------

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS ig_account_id uuid REFERENCES public.project_instagram_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ig_codewords_account
  ON public.instagram_codewords(ig_account_id);

ALTER TABLE public.instagram_organic_events
  ADD COLUMN IF NOT EXISTS ig_account_id uuid REFERENCES public.project_instagram_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ig_events_account_date
  ON public.instagram_organic_events(ig_account_id, date DESC);

-- 3) Идемпотентность событий ------------------------------------------------

ALTER TABLE public.instagram_organic_events
  ADD COLUMN IF NOT EXISTS external_event_id text;

-- UNIQUE в рамках проекта (один и тот же external_event_id для разных
-- проектов — это норм).
CREATE UNIQUE INDEX IF NOT EXISTS ig_events_external_unique
  ON public.instagram_organic_events(project_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- 4) Триггер: при insert события — обновить last_event_at у аккаунта и
--    привязать ig_account_id если он не задан, но мы можем его подобрать
--    по code-word.
CREATE OR REPLACE FUNCTION public.ig_event_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF NEW.ig_account_id IS NULL AND NEW.codeword_id IS NOT NULL THEN
    SELECT ig_account_id INTO v_account_id
      FROM public.instagram_codewords WHERE id = NEW.codeword_id;
    IF v_account_id IS NOT NULL THEN
      UPDATE public.instagram_organic_events
        SET ig_account_id = v_account_id WHERE id = NEW.id;
      NEW.ig_account_id := v_account_id;
    END IF;
  END IF;

  IF NEW.ig_account_id IS NOT NULL THEN
    UPDATE public.project_instagram_accounts
      SET last_event_at = GREATEST(coalesce(last_event_at, NEW.occurred_at), NEW.occurred_at),
          status = CASE WHEN status IN ('pending', 'disconnected') THEN 'connected' ELSE status END,
          connected_at = COALESCE(connected_at, NEW.occurred_at)
      WHERE id = NEW.ig_account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ig_event_after_insert ON public.instagram_organic_events;
CREATE TRIGGER trg_ig_event_after_insert
  AFTER INSERT ON public.instagram_organic_events
  FOR EACH ROW EXECUTE FUNCTION public.ig_event_after_insert();

-- 5) Late-attribution: lookup code-word по username/contact -----------------
-- Возвращает codeword_id, если на этом проекте был свежий codeword_dm от
-- такого же username/contact в последние N дней. Используется lead-intake
-- для случаев, когда лид пришёл без явного cw=.
CREATE OR REPLACE FUNCTION public.match_recent_codeword(
  p_project_id uuid,
  p_username   text DEFAULT NULL,
  p_contact    text DEFAULT NULL,
  p_max_age    interval DEFAULT '14 days'
)
RETURNS TABLE (
  codeword_id uuid,
  codeword    text,
  reel_id     text,
  reel_url    text,
  ig_account_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.codeword_id, e.codeword, e.reel_id, e.reel_url, e.ig_account_id
  FROM public.instagram_organic_events e
  WHERE e.project_id = p_project_id
    AND e.event_type = 'codeword_dm'
    AND e.codeword_id IS NOT NULL
    AND e.occurred_at >= now() - p_max_age
    AND (
      (p_username IS NOT NULL AND e.username IS NOT NULL AND lower(e.username) = lower(p_username))
      OR
      (p_contact IS NOT NULL AND e.contact IS NOT NULL AND regexp_replace(e.contact, '\D', '', 'g') = regexp_replace(p_contact, '\D', '', 'g'))
    )
  ORDER BY e.occurred_at DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.match_recent_codeword(uuid, text, text, interval)
  TO authenticated, service_role;

-- 6) Обновляем view stats — теперь экспонируем ig_account_id ---------------
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
    COUNT(*) FILTER (WHERE l.paid)                              AS sales,
    COALESCE(SUM(l.amount) FILTER (WHERE l.paid), 0)::numeric    AS revenue
  FROM ev
  LEFT JOIN public.leads l ON l.id = ANY(ev.lead_ids)
  GROUP BY ev.codeword_id
)
SELECT
  w.id                                  AS codeword_id,
  w.project_id,
  w.ig_account_id,
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

-- 7) Per-account дневная воронка --------------------------------------------
DROP VIEW IF EXISTS public.instagram_account_daily;

CREATE VIEW public.instagram_account_daily AS
SELECT
  e.project_id,
  e.ig_account_id,
  e.date,
  COUNT(*) FILTER (WHERE e.event_type = 'codeword_dm')             AS codeword_dms,
  COUNT(DISTINCT e.username) FILTER (WHERE e.event_type = 'codeword_dm') AS unique_users,
  COUNT(*) FILTER (WHERE e.event_type = 'link_click')              AS link_clicks,
  COUNT(*) FILTER (WHERE e.event_type = 'lead')                    AS leads
FROM public.instagram_organic_events e
WHERE e.project_id IS NOT NULL AND e.ig_account_id IS NOT NULL
GROUP BY e.project_id, e.ig_account_id, e.date;

ALTER VIEW public.instagram_account_daily SET (security_invoker = true);
