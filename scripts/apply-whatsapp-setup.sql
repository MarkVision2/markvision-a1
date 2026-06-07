-- =============================================================================
-- WhatsApp / Green API setup for MarkVision
-- =============================================================================
-- ВАЖНО: выполняйте только в проекте mekwfbqmsqiborjdrjxc (MarkVision).
-- НЕ в Clony (szfgdruhlebfvcmlvxdk) и не в пустом тестовом проекте.
--
-- Проверка перед запуском (должна вернуть строку whatsapp_config или projects):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN ('whatsapp_config', 'projects');
-- =============================================================================

-- --- 0. Bootstrap table if missing (fresh / wrong partial migrate) ---
CREATE TABLE IF NOT EXISTS public.whatsapp_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  id_instance text,
  api_token text,
  api_url text,
  webhook_url text,
  webhook_token text,
  bot_webhook_url text,
  phone text,
  display_name text,
  connected boolean NOT NULL DEFAULT false,
  connected_at timestamptz,
  ads_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_project_uniq
  ON public.whatsapp_config(project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_instance_uniq
  ON public.whatsapp_config(id_instance) WHERE id_instance IS NOT NULL;

ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_select_own" ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_insert_own" ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_update_own" ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_delete_own" ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_select" ON public.whatsapp_config;
DROP POLICY IF EXISTS wa_select ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_insert" ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_update" ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_delete" ON public.whatsapp_config;

CREATE POLICY wa_select ON public.whatsapp_config
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR user_id = auth.uid()
    OR (project_id IS NOT NULL AND public.user_can_access_project(project_id))
  );

CREATE POLICY wa_insert ON public.whatsapp_config
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY wa_update ON public.whatsapp_config
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY wa_delete ON public.whatsapp_config
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- --- 1. Columns & defaults ---
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS bot_webhook_url text,
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS webhook_token text,
  ADD COLUMN IF NOT EXISTS api_token text,
  ADD COLUMN IF NOT EXISTS api_url text,
  ADD COLUMN IF NOT EXISTS id_instance text,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS ads_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_config
  ALTER COLUMN ads_only SET DEFAULT false;

-- Generated flags (ignore if already exist)
DO $$ BEGIN
  ALTER TABLE public.whatsapp_config
    ADD COLUMN api_token_present boolean
      GENERATED ALWAYS AS (api_token IS NOT NULL AND length(api_token) > 0) STORED;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.whatsapp_config
    ADD COLUMN webhook_token_present boolean
      GENERATED ALWAYS AS (webhook_token IS NOT NULL AND length(webhook_token) > 0) STORED;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

REVOKE SELECT (api_token, webhook_token) ON public.whatsapp_config FROM PUBLIC, authenticated, anon;
REVOKE UPDATE (api_token, webhook_token, api_url) ON public.whatsapp_config FROM PUBLIC, authenticated, anon;
GRANT SELECT (api_token_present, webhook_token_present) ON public.whatsapp_config TO authenticated;

-- --- 2. Safe view ---
DROP VIEW IF EXISTS public.whatsapp_config_safe;
CREATE VIEW public.whatsapp_config_safe
WITH (security_invoker = true) AS
SELECT
  id,
  user_id,
  project_id,
  id_instance,
  api_url,
  phone,
  connected,
  connected_at,
  display_name,
  webhook_url,
  bot_webhook_url,
  ads_only,
  updated_at,
  api_token_present,
  webhook_token_present
FROM public.whatsapp_config;

GRANT SELECT ON public.whatsapp_config_safe TO authenticated;

-- --- 3. RPC: save n8n bot URL ---
CREATE OR REPLACE FUNCTION public.save_whatsapp_bot_webhook(
  p_project_id uuid,
  p_bot_webhook_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.created_by = auth.uid())
    OR public.is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_url := NULLIF(btrim(p_bot_webhook_url), '');
  IF v_url IS NOT NULL AND v_url !~* '^https://[^?#]+' THEN
    RAISE EXCEPTION 'bot_webhook_url must use https';
  END IF;

  UPDATE public.whatsapp_config
     SET bot_webhook_url = v_url,
         updated_at = now()
   WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp_config not found for project — bind Green API instance first (step 1 in app)';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_whatsapp_bot_webhook(uuid, text) TO authenticated;

-- --- 4. RPC: bind Green API instance ---
CREATE OR REPLACE FUNCTION public.normalize_green_api_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_trimmed text;
  v_host text;
BEGIN
  IF p_url IS NULL OR btrim(p_url) = '' THEN RETURN NULL; END IF;
  v_trimmed := regexp_replace(btrim(p_url), '/+$', '');
  IF v_trimmed !~* '^https://[^/?#]+$' THEN
    RAISE EXCEPTION 'api_url must be a bare https origin';
  END IF;
  v_host := lower(substring(v_trimmed from '^https://([^/:]+)'));
  IF v_host IN ('api.green-api.com', 'api.greenapi.com')
     OR v_host ~ '^[a-z0-9-]+\.api\.greenapi\.com$' THEN
    RETURN v_trimmed;
  END IF;
  RAISE EXCEPTION 'api_url host not allowed';
END;
$$;

DROP FUNCTION IF EXISTS public.bind_whatsapp_to_project(uuid, text);
DROP FUNCTION IF EXISTS public.bind_whatsapp_to_project(uuid, text, text);
DROP FUNCTION IF EXISTS public.bind_whatsapp_to_project(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.bind_whatsapp_to_project(
  p_project_id uuid,
  p_id_instance text,
  p_api_token text DEFAULT NULL,
  p_api_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_api_url text;
BEGIN
  IF p_project_id IS NULL OR p_id_instance IS NULL OR p_id_instance = '' THEN
    RAISE EXCEPTION 'project_id and id_instance are required';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.created_by = auth.uid())
    OR public.is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_api_url IS NOT NULL AND btrim(p_api_url) <> '' THEN
    v_api_url := public.normalize_green_api_url(p_api_url);
  ELSE
    v_api_url := NULL;
  END IF;

  SELECT id INTO v_existing_id FROM public.whatsapp_config WHERE project_id = p_project_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.whatsapp_config (user_id, project_id, id_instance, api_token, api_url, connected)
    VALUES (auth.uid(), p_project_id, p_id_instance, NULLIF(btrim(p_api_token), ''), v_api_url, false)
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.whatsapp_config
       SET id_instance = p_id_instance,
           user_id     = COALESCE(user_id, auth.uid()),
           api_token   = CASE WHEN p_api_token IS NOT NULL AND btrim(p_api_token) <> ''
                              THEN btrim(p_api_token) ELSE api_token END,
           api_url     = COALESCE(v_api_url, api_url),
           updated_at  = now()
     WHERE id = v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bind_whatsapp_to_project(uuid, text, text, text) TO authenticated;

-- --- 5. WhatsApp leads visible in CRM (unassigned inbound pool) ---
DROP POLICY IF EXISTS leads_select_visible ON public.leads;
DROP POLICY IF EXISTS leads_update_visible ON public.leads;

CREATE POLICY leads_select_visible ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR (assigned_to IS NULL AND created_by IS NULL)
      )
    )
  );

CREATE POLICY leads_update_visible ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (
        assigned_to = auth.uid()
        OR created_by = auth.uid()
        OR (assigned_to IS NULL AND created_by IS NULL)
      )
    )
  );

DROP POLICY IF EXISTS comm_select_via_lead ON public.communications;

CREATE POLICY comm_select_via_lead ON public.communications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = communications.lead_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR (
            l.project_id IS NOT NULL
            AND public.user_can_access_project(l.project_id)
            AND (
              l.assigned_to = auth.uid()
              OR l.created_by = auth.uid()
              OR (l.assigned_to IS NULL AND l.created_by IS NULL)
            )
          )
        )
    )
  );

NOTIFY pgrst, 'reload schema';

SELECT 'whatsapp_setup OK' AS status,
       count(*) AS rows_in_whatsapp_config
  FROM public.whatsapp_config;
