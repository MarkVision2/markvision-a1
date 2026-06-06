-- Security scan fixes (Lovable): tokens, leads RLS, CDR, automation_settings flags.

-- ============================================================
-- 1. Instagram: page_access_token не читается с клиента
-- ============================================================
REVOKE SELECT (page_access_token) ON public.instagram_accounts FROM authenticated, anon;

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS page_token_present boolean
  GENERATED ALWAYS AS (page_access_token IS NOT NULL AND length(page_access_token) > 0) STORED;

GRANT SELECT (page_token_present) ON public.instagram_accounts TO authenticated;

DROP POLICY IF EXISTS ig_accounts_select ON public.instagram_accounts;
CREATE POLICY ig_accounts_select ON public.instagram_accounts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.user_can_access_project(project_id)
  );

-- ============================================================
-- 2. WhatsApp: api_token + webhook_token не читаются с клиента
-- ============================================================
REVOKE SELECT (api_token, webhook_token) ON public.whatsapp_config FROM authenticated, anon;

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS api_token_present boolean
    GENERATED ALWAYS AS (api_token IS NOT NULL AND length(api_token) > 0) STORED,
  ADD COLUMN IF NOT EXISTS webhook_token_present boolean
    GENERATED ALWAYS AS (webhook_token IS NOT NULL AND length(webhook_token) > 0) STORED;

GRANT SELECT (api_token_present, webhook_token_present) ON public.whatsapp_config TO authenticated;

-- RPC: сохранение токена только через функцию (не SELECT)
DROP FUNCTION IF EXISTS public.bind_whatsapp_to_project(uuid, text);
CREATE OR REPLACE FUNCTION public.bind_whatsapp_to_project(
  p_project_id uuid,
  p_id_instance text,
  p_api_token text DEFAULT NULL,
  p_api_url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
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

  SELECT id INTO v_existing_id
    FROM public.whatsapp_config
   WHERE project_id = p_project_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.whatsapp_config (user_id, project_id, id_instance, api_token, api_url, connected)
    VALUES (auth.uid(), p_project_id, p_id_instance, NULLIF(trim(p_api_token), ''), NULLIF(trim(p_api_url), ''), false)
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.whatsapp_config
       SET id_instance = p_id_instance,
           user_id     = COALESCE(user_id, auth.uid()),
           api_token   = CASE WHEN p_api_token IS NOT NULL AND trim(p_api_token) <> ''
                              THEN trim(p_api_token) ELSE api_token END,
           api_url     = COALESCE(NULLIF(trim(p_api_url), ''), api_url),
           updated_at  = now()
     WHERE id = v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bind_whatsapp_to_project(uuid, text, text, text) TO authenticated;

-- ============================================================
-- 3. automation_settings: флаг meta token (секреты уже REVOKE)
-- ============================================================
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS meta_access_token_present boolean
  GENERATED ALWAYS AS (meta_access_token IS NOT NULL AND length(meta_access_token) > 0) STORED;

GRANT SELECT (meta_access_token_present) ON public.automation_settings TO authenticated;

-- ============================================================
-- 4. Leads: только в своих проектах (не кросс-тенант)
-- ============================================================
DROP POLICY IF EXISTS leads_select_visible ON public.leads;
DROP POLICY IF EXISTS leads_update_visible ON public.leads;

CREATE POLICY leads_select_visible ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );

CREATE POLICY leads_update_visible ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      project_id IS NOT NULL
      AND public.user_can_access_project(project_id)
      AND (assigned_to = auth.uid() OR created_by = auth.uid())
    )
  );

-- ============================================================
-- 5. Sipuni CDR: убрать доступ через leads с project_id IS NULL
-- ============================================================
DROP POLICY IF EXISTS sipuni_cdr_log_select_via_lead ON public.sipuni_cdr_log;

CREATE POLICY sipuni_cdr_log_select_via_lead ON public.sipuni_cdr_log
  FOR SELECT TO authenticated
  USING (
    lead_id_resolved IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = sipuni_cdr_log.lead_id_resolved
        AND l.project_id IS NOT NULL
        AND public.user_can_access_project(l.project_id)
        AND (
          public.has_role(auth.uid(), 'admin')
          OR l.assigned_to = auth.uid()
          OR l.created_by = auth.uid()
        )
    )
  );
