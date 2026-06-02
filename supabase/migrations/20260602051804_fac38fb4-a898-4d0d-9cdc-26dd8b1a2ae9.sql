-- Instagram accounts (one per project)
CREATE TABLE public.instagram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE,
  ig_user_id text NOT NULL,
  username text,
  name text,
  profile_picture_url text,
  page_id text NOT NULL,
  page_name text,
  page_access_token text NOT NULL,
  followers_count integer DEFAULT 0,
  follows_count integer DEFAULT 0,
  media_count integer DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_instagram_accounts_project ON public.instagram_accounts(project_id);

GRANT SELECT ON public.instagram_accounts TO authenticated;
GRANT ALL ON public.instagram_accounts TO service_role;

ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ig_accounts_select"
  ON public.instagram_accounts FOR SELECT
  TO authenticated
  USING (public.user_can_access_project(project_id));

-- NOTE: no INSERT/UPDATE/DELETE policies for authenticated — only service_role can mutate.

CREATE TRIGGER trg_instagram_accounts_updated_at
BEFORE UPDATE ON public.instagram_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Instagram media (posts / reels / stories)
CREATE TABLE public.instagram_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  ig_user_id text NOT NULL,
  media_id text NOT NULL UNIQUE,
  media_type text,                     -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type text,             -- FEED | REELS | STORY | AD
  caption text,
  permalink text,
  thumbnail_url text,
  media_url text,
  timestamp timestamptz,
  like_count integer DEFAULT 0,
  comments_count integer DEFAULT 0,
  shares_count integer DEFAULT 0,
  saved_count integer DEFAULT 0,
  reach integer DEFAULT 0,
  impressions integer DEFAULT 0,
  video_views integer DEFAULT 0,
  plays integer DEFAULT 0,
  total_interactions integer DEFAULT 0,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_instagram_media_project_time ON public.instagram_media(project_id, timestamp DESC);
CREATE INDEX idx_instagram_media_type ON public.instagram_media(project_id, media_product_type);

GRANT SELECT ON public.instagram_media TO authenticated;
GRANT ALL ON public.instagram_media TO service_role;

ALTER TABLE public.instagram_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ig_media_select"
  ON public.instagram_media FOR SELECT
  TO authenticated
  USING (public.user_can_access_project(project_id));

-- Daily account snapshot
CREATE TABLE public.instagram_account_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  ig_user_id text NOT NULL,
  date date NOT NULL,
  followers integer DEFAULT 0,
  reach integer DEFAULT 0,
  impressions integer DEFAULT 0,
  profile_views integer DEFAULT 0,
  website_clicks integer DEFAULT 0,
  new_followers integer DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ig_user_id, date)
);
CREATE INDEX idx_ig_account_daily_project_date ON public.instagram_account_daily(project_id, date DESC);

GRANT SELECT ON public.instagram_account_daily TO authenticated;
GRANT ALL ON public.instagram_account_daily TO service_role;

ALTER TABLE public.instagram_account_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ig_account_daily_select"
  ON public.instagram_account_daily FOR SELECT
  TO authenticated
  USING (public.user_can_access_project(project_id));

-- Audience demographics (snapshot)
CREATE TABLE public.instagram_demographics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  ig_user_id text NOT NULL,
  dimension text NOT NULL,             -- city | country | age | gender | age_gender
  key text NOT NULL,
  value integer NOT NULL DEFAULT 0,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ig_user_id, dimension, key)
);
CREATE INDEX idx_ig_demographics_project ON public.instagram_demographics(project_id, dimension);

GRANT SELECT ON public.instagram_demographics TO authenticated;
GRANT ALL ON public.instagram_demographics TO service_role;

ALTER TABLE public.instagram_demographics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ig_demographics_select"
  ON public.instagram_demographics FOR SELECT
  TO authenticated
  USING (public.user_can_access_project(project_id));
