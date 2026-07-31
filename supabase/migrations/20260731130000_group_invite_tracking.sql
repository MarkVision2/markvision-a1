-- Трекинг публичных invite-ссылок WhatsApp-группы:
-- клики через /g/:slug → 302 на chat.whatsapp.com,
-- вступления — по составу группы (getGroupData), новые номера после baseline.

CREATE TABLE IF NOT EXISTS public.group_invite_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL DEFAULT '',
  invite_url text NOT NULL,
  invite_code text,
  group_id text,
  is_active boolean NOT NULL DEFAULT true,
  baseline_taken boolean NOT NULL DEFAULT false,
  tracking_started_at timestamptz NOT NULL DEFAULT now(),
  click_count integer NOT NULL DEFAULT 0,
  join_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_invite_links_slug_uniq UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS group_invite_links_project_idx
  ON public.group_invite_links(project_id);
CREATE INDEX IF NOT EXISTS group_invite_links_group_idx
  ON public.group_invite_links(group_id)
  WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.group_invite_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.group_invite_links(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  date date NOT NULL,
  user_agent text,
  referrer text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS group_invite_clicks_link_date_idx
  ON public.group_invite_clicks(link_id, date DESC);
CREATE INDEX IF NOT EXISTS group_invite_clicks_project_date_idx
  ON public.group_invite_clicks(project_id, date DESC);

CREATE TABLE IF NOT EXISTS public.group_invite_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.group_invite_links(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phone_digits text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  /** false = уже были в группе на старте трекинга; true = вступили после метки */
  joined_via_link boolean NOT NULL DEFAULT false,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  CONSTRAINT group_invite_members_uniq UNIQUE (link_id, phone_digits)
);

CREATE INDEX IF NOT EXISTS group_invite_members_link_join_idx
  ON public.group_invite_members(link_id)
  WHERE joined_via_link;

ALTER TABLE public.group_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invite_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invite_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gil_select ON public.group_invite_links;
CREATE POLICY gil_select ON public.group_invite_links
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS gil_admin_write ON public.group_invite_links;
CREATE POLICY gil_admin_write ON public.group_invite_links
  FOR ALL TO authenticated
  USING (
    public.user_can_access_project(project_id)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    public.user_can_access_project(project_id)
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS gic_select ON public.group_invite_clicks;
CREATE POLICY gic_select ON public.group_invite_clicks
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS gim_select ON public.group_invite_members;
CREATE POLICY gim_select ON public.group_invite_members
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

GRANT SELECT ON public.group_invite_links TO authenticated;
GRANT SELECT ON public.group_invite_clicks TO authenticated;
GRANT SELECT ON public.group_invite_members TO authenticated;
GRANT ALL ON public.group_invite_links TO service_role;
GRANT ALL ON public.group_invite_clicks TO service_role;
GRANT ALL ON public.group_invite_members TO service_role;

DROP TRIGGER IF EXISTS update_group_invite_links_updated_at ON public.group_invite_links;
CREATE TRIGGER update_group_invite_links_updated_at
BEFORE UPDATE ON public.group_invite_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed: Lab / воркшоп MarkVision AI
INSERT INTO public.group_invite_links (
  project_id, slug, label, invite_url, invite_code, group_id, is_active
) VALUES (
  'cceb9a86-687b-4417-9b4e-d106bd8cc79c',
  'lab',
  'Воркшоп · WhatsApp-группа',
  'https://chat.whatsapp.com/JqhTdCL3koe9CaGXaCqj4e',
  'JqhTdCL3koe9CaGXaCqj4e',
  '120363410589545830@g.us',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  invite_url = EXCLUDED.invite_url,
  invite_code = EXCLUDED.invite_code,
  group_id = EXCLUDED.group_id,
  label = EXCLUDED.label,
  is_active = true,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

-- Atomic click counter
CREATE OR REPLACE FUNCTION public.bump_group_invite_click(p_link_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.group_invite_links
  SET click_count = click_count + 1, updated_at = now()
  WHERE id = p_link_id;
$$;

REVOKE ALL ON FUNCTION public.bump_group_invite_click(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_group_invite_click(uuid) TO service_role;
