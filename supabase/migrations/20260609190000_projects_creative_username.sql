-- Instagram-ник проекта для подписи на креативах (webhook username).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS creative_username text;

COMMENT ON COLUMN public.projects.creative_username IS
  'Instagram handle без @. Уходит в n8n как username, если заполнен.';

CREATE OR REPLACE FUNCTION public.set_project_creative_username(
  p_project_id uuid,
  p_username text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clean text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.projects
      WHERE id = p_project_id AND created_by = auth.uid()
    )
    OR public.is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  v_clean := NULLIF(trim(BOTH '@' FROM trim(COALESCE(p_username, ''))), '');

  UPDATE public.projects
  SET creative_username = v_clean
  WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  RETURN v_clean;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_project_creative_username(uuid, text) TO authenticated;
