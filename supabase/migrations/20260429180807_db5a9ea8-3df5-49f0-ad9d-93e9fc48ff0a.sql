ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS sipuni_enabled boolean NOT NULL DEFAULT false;

-- Computed-style helper: a generated boolean that says whether the secret is set,
-- without exposing the secret. Generated columns work because input columns are in same row.
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS sipuni_token_present boolean
    GENERATED ALWAYS AS (sipuni_token IS NOT NULL AND length(sipuni_token) > 0) STORED;

-- Allow safe reads/updates for the new flag, plus read of the indicator.
GRANT SELECT (sipuni_enabled, sipuni_token_present) ON public.automation_settings TO authenticated;
GRANT UPDATE (sipuni_enabled) ON public.automation_settings TO authenticated;