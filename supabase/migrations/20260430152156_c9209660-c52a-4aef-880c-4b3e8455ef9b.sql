-- Расширяем ad_cabinets полями конфигурации для автозапуска рекламы

ALTER TABLE public.ad_cabinets
  -- Meta доступы
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS app_id text,
  ADD COLUMN IF NOT EXISTS ad_account_id text,
  ADD COLUMN IF NOT EXISTS page_id text,
  ADD COLUMN IF NOT EXISTS pixel_id text,
  ADD COLUMN IF NOT EXISTS business_id text,
  ADD COLUMN IF NOT EXISTS campaign_objective text,
  ADD COLUMN IF NOT EXISTS optimization_goal text,
  ADD COLUMN IF NOT EXISTS lead_form_id text,

  -- Бюджет и расписание
  ADD COLUMN IF NOT EXISTS daily_budget numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KZT',
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS days_of_week integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Almaty',
  ADD COLUMN IF NOT EXISTS auto_launch_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS launch_hour integer NOT NULL DEFAULT 9,

  -- Таргетинг
  ADD COLUMN IF NOT EXISTS target_geo text[],
  ADD COLUMN IF NOT EXISTS target_age_min integer,
  ADD COLUMN IF NOT EXISTS target_age_max integer,
  ADD COLUMN IF NOT EXISTS target_gender text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_languages text[],
  ADD COLUMN IF NOT EXISTS target_interests jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS target_exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Креатив и оффер
  ADD COLUMN IF NOT EXISTS creative_headline text,
  ADD COLUMN IF NOT EXISTS creative_primary_text text,
  ADD COLUMN IF NOT EXISTS creative_description text,
  ADD COLUMN IF NOT EXISTS creative_cta text,
  ADD COLUMN IF NOT EXISTS creative_media_urls text[],
  ADD COLUMN IF NOT EXISTS landing_url text,
  ADD COLUMN IF NOT EXISTS utm_template text,
  ADD COLUMN IF NOT EXISTS brief text;

-- Индекс для крон-выборки активных кабинетов с автозапуском
CREATE INDEX IF NOT EXISTS idx_ad_cabinets_auto_launch
  ON public.ad_cabinets (auto_launch_enabled, online)
  WHERE auto_launch_enabled = true;