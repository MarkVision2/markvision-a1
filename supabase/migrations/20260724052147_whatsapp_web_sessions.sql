-- Free WhatsApp Web (QR / multi-device) connector for CRM inbox.
-- Separate from Green API (automations / broadcasts stay on Green).

CREATE TABLE IF NOT EXISTS public.whatsapp_web_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'pairing', 'connected', 'error')),
  phone text,
  display_name text,
  qr_data text,
  qr_expires_at timestamptz,
  last_error text,
  worker_heartbeat_at timestamptz,
  paired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_web_sessions_status_idx
  ON public.whatsapp_web_sessions (status);

CREATE TABLE IF NOT EXISTS public.whatsapp_web_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('pair', 'logout', 'send')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS whatsapp_web_commands_pending_idx
  ON public.whatsapp_web_commands (status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.whatsapp_web_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_web_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wws_select_project ON public.whatsapp_web_sessions;
CREATE POLICY wws_select_project ON public.whatsapp_web_sessions
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- Clients never write sessions directly — only via edge wa-web-bridge.
DROP POLICY IF EXISTS wwc_select_project ON public.whatsapp_web_commands;
CREATE POLICY wwc_select_project ON public.whatsapp_web_commands
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

COMMENT ON TABLE public.whatsapp_web_sessions IS
  'WhatsApp Web multi-device sessions (Baileys daemon). Free CRM inbox; Green API remains for automations.';
COMMENT ON TABLE public.whatsapp_web_commands IS
  'Command queue from CRM UI → VPS wa-web-daemon (pair / logout / send).';
