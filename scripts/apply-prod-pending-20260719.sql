-- =============================================================================
-- MarkVision AI — единый SQL для прода (исправленный)
-- Проект: szfgdruhlebfvcmlvxdk
-- Содержит: launch funnel + short_id fix + Instagram Login + content_plan_items
-- Безопасно запускать повторно (IF NOT EXISTS / DROP IF EXISTS).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) short_id без pgcrypto (фикс «Не удалось добавить» код-слово)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gen_codeword_short_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT substr(
    translate(
      md5(random()::text || clock_timestamp()::text || coalesce(inet_client_addr()::text, '')),
      'abcdef',
      'ghijkl'
    ),
    1,
    10
  );
$$;

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS comment_replies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dm_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS target_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS short_id text;

UPDATE public.instagram_codewords
   SET short_id = public.gen_codeword_short_id()
 WHERE short_id IS NULL OR btrim(short_id) = '';

ALTER TABLE public.instagram_codewords
  ALTER COLUMN short_id SET DEFAULT public.gen_codeword_short_id();

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.instagram_codewords ALTER COLUMN short_id SET NOT NULL;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS instagram_codewords_short_id_key
  ON public.instagram_codewords(short_id);

-- ---------------------------------------------------------------------------
-- B) Instagram Login token + nullable page_* + safe view
-- ---------------------------------------------------------------------------
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS ig_login_access_token text;

ALTER TABLE public.instagram_accounts
  ALTER COLUMN page_id DROP NOT NULL;

ALTER TABLE public.instagram_accounts
  ALTER COLUMN page_access_token DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'instagram_accounts'
      AND column_name = 'ig_login_token_present'
  ) THEN
    ALTER TABLE public.instagram_accounts
      ADD COLUMN ig_login_token_present boolean
      GENERATED ALWAYS AS (ig_login_access_token IS NOT NULL AND length(ig_login_access_token) > 0) STORED;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'instagram_accounts'
      AND column_name = 'page_token_present'
  ) THEN
    ALTER TABLE public.instagram_accounts
      ADD COLUMN page_token_present boolean
      GENERATED ALWAYS AS (page_access_token IS NOT NULL AND length(page_access_token) > 0) STORED;
  END IF;
END $$;

GRANT SELECT ON public.instagram_accounts TO authenticated;

DROP VIEW IF EXISTS public.instagram_accounts_safe;
CREATE VIEW public.instagram_accounts_safe
WITH (security_invoker = true) AS
SELECT
  id, project_id, ig_user_id, username, name, profile_picture_url,
  page_id, page_name, page_token_present, ig_login_token_present,
  followers_count, follows_count, media_count, active,
  last_sync_at, last_error, created_at, updated_at
FROM public.instagram_accounts;

GRANT SELECT ON public.instagram_accounts_safe TO authenticated;
REVOKE ALL ON public.instagram_accounts_safe FROM anon;
REVOKE SELECT (page_access_token) ON public.instagram_accounts FROM PUBLIC, authenticated, anon;
REVOKE SELECT (ig_login_access_token) ON public.instagram_accounts FROM PUBLIC, authenticated, anon;

-- ---------------------------------------------------------------------------
-- C) AI Marketing Lab launch funnel (исправленный RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS template_key text;

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS stage_role text NOT NULL DEFAULT 'other';

UPDATE public.pipeline_stages SET stage_role = 'new'            WHERE key = 'new' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'whatsapp'       WHERE key IN ('no_answer') AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'interest'       WHERE key = 'in_progress' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'offer'          WHERE key = 'invoice' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'call_scheduled' WHERE key = 'scheduled' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'attended'       WHERE key = 'visit' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'paid'           WHERE key = 'paid' AND stage_role = 'other';
UPDATE public.pipeline_stages SET stage_role = 'rejected'       WHERE key = 'rejected' AND stage_role = 'other';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS temperature text,
  ADD COLUMN IF NOT EXISTS webinar_status text,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric,
  ADD COLUMN IF NOT EXISTS cohort text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_temperature_check') THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_temperature_check
      CHECK (temperature IS NULL OR temperature IN ('hot', 'warm', 'cold'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_webinar_status_check') THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_webinar_status_check
      CHECK (webinar_status IS NULL OR webinar_status IN ('attended', 'late', 'no_show'));
  END IF;
END $$;

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

-- ВАЖНО: user_can_access_project(uuid), НЕ is_project_member(uuid)
DROP POLICY IF EXISTS crm_automation_events_select_members ON public.crm_automation_events;
CREATE POLICY crm_automation_events_select_members
  ON public.crm_automation_events
  FOR SELECT
  TO authenticated
  USING (
    project_id IS NULL
    OR public.user_can_access_project(project_id)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

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

-- ---------------------------------------------------------------------------
-- D) Контент-план
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'content',
  content_type text NOT NULL DEFAULT 'REELS',
  status text NOT NULL DEFAULT 'idea',
  description text,
  hashtags text,
  prompts text,
  comments_notes text,
  media_url text,
  thumbnail_url text,
  child_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  post_instagram boolean NOT NULL DEFAULT true,
  post_facebook boolean NOT NULL DEFAULT false,
  post_threads boolean NOT NULL DEFAULT false,
  post_telegram boolean NOT NULL DEFAULT false,
  post_linkedin boolean NOT NULL DEFAULT false,
  autopost_id text,
  ig_media_id text,
  codeword_id uuid REFERENCES public.instagram_codewords(id) ON DELETE SET NULL,
  codeword text,
  utm_content text,
  ad_spend numeric NOT NULL DEFAULT 0,
  ai_analysis text,
  sort_index integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_plan_items_category_check CHECK (
    category IN ('content', 'sales', 'case', 'ai', 'personal', 'reviews', 'errors', 'news')
  ),
  CONSTRAINT content_plan_items_type_check CHECK (
    content_type IN ('REELS', 'CAROUSEL', 'IMAGE', 'STORIES')
  ),
  CONSTRAINT content_plan_items_status_check CHECK (
    status IN ('idea', 'in_progress', 'ready', 'scheduled', 'published', 'error')
  )
);

CREATE INDEX IF NOT EXISTS content_plan_items_project_idx
  ON public.content_plan_items (project_id, scheduled_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS content_plan_items_codeword_idx
  ON public.content_plan_items (codeword_id)
  WHERE codeword_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_plan_items_ig_media_idx
  ON public.content_plan_items (project_id, ig_media_id)
  WHERE ig_media_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS content_plan_items_utm_content_uidx
  ON public.content_plan_items (project_id, utm_content)
  WHERE utm_content IS NOT NULL AND length(utm_content) > 0;

ALTER TABLE public.content_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_plan_items_select ON public.content_plan_items;
CREATE POLICY content_plan_items_select
  ON public.content_plan_items FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS content_plan_items_insert ON public.content_plan_items;
CREATE POLICY content_plan_items_insert
  ON public.content_plan_items FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS content_plan_items_update ON public.content_plan_items;
CREATE POLICY content_plan_items_update
  ON public.content_plan_items FOR UPDATE TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS content_plan_items_delete ON public.content_plan_items;
CREATE POLICY content_plan_items_delete
  ON public.content_plan_items FOR DELETE TO authenticated
  USING (public.user_can_access_project(project_id));

DROP TRIGGER IF EXISTS trg_content_plan_items_updated ON public.content_plan_items;
CREATE TRIGGER trg_content_plan_items_updated
  BEFORE UPDATE ON public.content_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.content_plan_assign_utm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  n integer;
BEGIN
  IF NEW.utm_content IS NOT NULL AND length(btrim(NEW.utm_content)) > 0 THEN
    RETURN NEW;
  END IF;
  prefix := CASE NEW.content_type
    WHEN 'REELS' THEN 'reels'
    WHEN 'CAROUSEL' THEN 'carousel'
    WHEN 'STORIES' THEN 'stories'
    ELSE 'post'
  END;
  SELECT COUNT(*) + 1 INTO n
  FROM public.content_plan_items
  WHERE project_id = NEW.project_id;
  NEW.utm_content := prefix || '_' || lpad(n::text, 3, '0');
  RETURN NEW;
END;
$$;

  DROP TRIGGER IF EXISTS trg_content_plan_assign_utm ON public.content_plan_items;
CREATE TRIGGER trg_content_plan_assign_utm
  BEFORE INSERT ON public.content_plan_items
  FOR EACH ROW EXECUTE FUNCTION public.content_plan_assign_utm();

-- ---------------------------------------------------------------------------
-- E) cf_scheduled_posts: разрешить CAROUSEL + STORIES (фикс ошибки «db»)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cf_scheduled_posts_media_type_check'
      AND conrelid = 'public.cf_scheduled_posts'::regclass
  ) THEN
    ALTER TABLE public.cf_scheduled_posts
      DROP CONSTRAINT cf_scheduled_posts_media_type_check;
  END IF;
END $$;

ALTER TABLE public.cf_scheduled_posts
  ADD CONSTRAINT cf_scheduled_posts_media_type_check
  CHECK (media_type = ANY (ARRAY[
    'IMAGE'::text,
    'REELS'::text,
    'STORIES'::text,
    'CAROUSEL'::text
  ]));

-- ---------------------------------------------------------------------------
-- F) content_plan_items: один IG media_id = одна строка (ручной + автопост)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS content_plan_items_project_ig_media_uidx
  ON public.content_plan_items (project_id, ig_media_id)
  WHERE ig_media_id IS NOT NULL AND length(btrim(ig_media_id)) > 0;

-- ---------------------------------------------------------------------------
-- G) ig-webhook: external_id + legacy reply_text/dm_text (иначе код-слова молчат)
-- ---------------------------------------------------------------------------
ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS reply_text text,
  ADD COLUMN IF NOT EXISTS dm_text text;

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user_id
  ON public.instagram_accounts(ig_user_id);

ALTER TABLE public.instagram_organic_events
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS instagram_organic_events_external_id_key
  ON public.instagram_organic_events (external_id)
  WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- H) Текст кнопки CTA в Instagram Direct
-- ---------------------------------------------------------------------------
ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS dm_button_title text;
