-- Sticky-атрибуция IG Direct: referral с рекламы (OPEN_THREAD) часто приходит
-- без текста, а код-слово — следующим сообщением. Храним ad/post по IGSID отправителя.
CREATE TABLE IF NOT EXISTS public.instagram_sender_attribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  meta_ad_id text,
  media_id text,
  referral jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS instagram_sender_attribution_project_sender_key
  ON public.instagram_sender_attribution (project_id, sender_id);

CREATE INDEX IF NOT EXISTS instagram_sender_attribution_updated_at_idx
  ON public.instagram_sender_attribution (updated_at DESC);

COMMENT ON TABLE public.instagram_sender_attribution IS
  'Последний Meta ad/post referral для IG Direct sender (IGSID), чтобы код-слово во 2-м сообщении сохранило атрибуцию.';

ALTER TABLE public.instagram_sender_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ig_sender_attr_select_scoped ON public.instagram_sender_attribution;
CREATE POLICY ig_sender_attr_select_scoped ON public.instagram_sender_attribution
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.owner_id = auth.uid()
         OR p.id IN (SELECT project_id FROM public.project_members WHERE user_id = auth.uid())
    )
  );
