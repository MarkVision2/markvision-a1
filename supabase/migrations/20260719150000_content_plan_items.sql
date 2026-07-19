-- Content Plan: единый реестр публикаций (идея → публикация → воронка → оплата).
-- Автопостинг (cf_scheduled_posts) не ломаем — связываем через autopost_id.

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

COMMENT ON TABLE public.content_plan_items IS
  'Контент-план: одна строка = одна публикация от идеи до выручки. Связь с автопостом (autopost_id) и код-словом (codeword_id).';

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

-- Автонумерация utm_content вида reels_001 / post_001 при insert, если пусто.
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
