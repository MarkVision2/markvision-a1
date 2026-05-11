-- 1 project = 1 WhatsApp instance.
-- The webhook resolves which project an incoming WA message belongs to via
-- whatsapp_config.id_instance (matched against Green API's instanceData.idInstance),
-- then routes the lead into the project's default pipeline / stage «Новая».

-- ============================================================
-- 1. Schema: surrogate PK, project binding, instance id
-- ============================================================

-- Drop user_id-only PK so we can hold multiple rows per user
-- (one per project).
ALTER TABLE public.whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_pkey;

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS id_instance text;

UPDATE public.whatsapp_config SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.whatsapp_config ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_pk_id;
ALTER TABLE public.whatsapp_config ADD CONSTRAINT whatsapp_config_pk_id PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_project_uniq
  ON public.whatsapp_config(project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_config_instance_uniq
  ON public.whatsapp_config(id_instance) WHERE id_instance IS NOT NULL;

-- ============================================================
-- 2. Backfill existing rows: assign to user's active project,
--    then fall back to any project they own.
-- ============================================================
UPDATE public.whatsapp_config wc
   SET project_id = uap.project_id
  FROM public.user_active_project uap
 WHERE wc.user_id = uap.user_id AND wc.project_id IS NULL;

UPDATE public.whatsapp_config wc
   SET project_id = (
         SELECT id FROM public.projects
          WHERE created_by = wc.user_id
          ORDER BY created_at ASC LIMIT 1
       )
 WHERE wc.project_id IS NULL;

-- ============================================================
-- 3. RLS: allow access through project ownership too,
--    not just user_id.
-- ============================================================
DROP POLICY IF EXISTS "wa_select_own"  ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_insert_own"  ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_update_own"  ON public.whatsapp_config;
DROP POLICY IF EXISTS "wa_delete_own"  ON public.whatsapp_config;

CREATE POLICY "wa_select" ON public.whatsapp_config
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR project_id IN (SELECT id FROM public.projects WHERE created_by = auth.uid())
    OR public.has_role(auth.uid(),'admin')
  );

CREATE POLICY "wa_insert" ON public.whatsapp_config
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "wa_update" ON public.whatsapp_config
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "wa_delete" ON public.whatsapp_config
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 4. RPC: bind / rebind a project to a Green API instance.
--    Idempotent — running again updates the binding.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bind_whatsapp_to_project(
  p_project_id uuid,
  p_id_instance text
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

  SELECT id INTO v_existing_id
    FROM public.whatsapp_config
   WHERE project_id = p_project_id;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.whatsapp_config (user_id, project_id, id_instance, connected)
    VALUES (auth.uid(), p_project_id, p_id_instance, false)
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.whatsapp_config
       SET id_instance = p_id_instance,
           user_id     = COALESCE(user_id, auth.uid()),
           updated_at  = now()
     WHERE id = v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bind_whatsapp_to_project(uuid, text) TO authenticated;
