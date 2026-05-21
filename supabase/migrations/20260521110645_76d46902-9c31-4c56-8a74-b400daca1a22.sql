
CREATE TABLE public.sipuni_cdr_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_payload jsonb,
  phone_normalized text,
  recording_url text,
  duration_sec int,
  started_at timestamptz,
  processing_status text NOT NULL CHECK (processing_status IN ('lead_found','lead_not_found','parse_error')),
  lead_id_resolved uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sipuni_cdr_log_created_at ON public.sipuni_cdr_log (created_at DESC);
CREATE INDEX idx_sipuni_cdr_log_phone ON public.sipuni_cdr_log (phone_normalized);
CREATE INDEX idx_sipuni_cdr_log_lead ON public.sipuni_cdr_log (lead_id_resolved);
CREATE INDEX idx_sipuni_cdr_log_status ON public.sipuni_cdr_log (processing_status);

ALTER TABLE public.sipuni_cdr_log ENABLE ROW LEVEL SECURITY;

-- Admin: full read
CREATE POLICY sipuni_cdr_log_select_admin
  ON public.sipuni_cdr_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Project members: read entries that resolved to a lead in their project
CREATE POLICY sipuni_cdr_log_select_via_lead
  ON public.sipuni_cdr_log
  FOR SELECT
  TO authenticated
  USING (
    lead_id_resolved IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = sipuni_cdr_log.lead_id_resolved
        AND (l.project_id IS NULL OR public.user_can_access_project(l.project_id))
    )
  );

-- No INSERT/UPDATE/DELETE policies — writes only via service-role (bypasses RLS)
