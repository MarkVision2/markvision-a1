-- Лидген · автостарт: qualified-лиды → получатели активной кампании (queued) +
-- перевод на стадию «В очереди на касание». Дедуп по телефону, учёт стоп-листа.
CREATE OR REPLACE FUNCTION public.lg_enroll_broadcast(p_project uuid, p_campaign uuid, p_limit int DEFAULT 300)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _qualified uuid; _queued uuid; _n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.broadcast_campaigns WHERE id = p_campaign AND project_id = p_project) THEN
    RETURN 0;
  END IF;
  SELECT ps.id INTO _qualified FROM public.pipeline_stages ps
    JOIN public.pipelines pl ON pl.id = ps.pipeline_id
    WHERE pl.project_id = p_project AND ps.key = 'qualified' LIMIT 1;
  SELECT ps.id INTO _queued FROM public.pipeline_stages ps
    JOIN public.pipelines pl ON pl.id = ps.pipeline_id
    WHERE pl.project_id = p_project AND ps.key = 'queued' LIMIT 1;
  IF _qualified IS NULL THEN RETURN 0; END IF;

  WITH cand AS (
    SELECT l.id, l.name, l.phone
    FROM public.leads l
    WHERE l.project_id = p_project
      AND l.stage_id = _qualified
      AND l.phone IS NOT NULL AND length(l.phone) >= 10
      AND NOT EXISTS (SELECT 1 FROM public.broadcast_recipients br WHERE br.campaign_id = p_campaign AND br.phone = l.phone)
      AND NOT EXISTS (SELECT 1 FROM public.broadcast_opt_outs oo WHERE oo.project_id = p_project AND oo.phone = l.phone)
    ORDER BY l.created_at
    LIMIT GREATEST(p_limit, 1)
  ),
  ins AS (
    INSERT INTO public.broadcast_recipients (campaign_id, project_id, lead_id, name, phone, status)
    SELECT p_campaign, p_project, c.id, c.name, c.phone, 'queued' FROM cand c
    ON CONFLICT (campaign_id, phone) DO NOTHING
    RETURNING lead_id
  )
  SELECT count(*) INTO _n FROM ins;

  IF _queued IS NOT NULL AND _n > 0 THEN
    UPDATE public.leads
      SET stage_id = _queued
      WHERE project_id = p_project AND stage_id = _qualified
        AND id IN (SELECT br.lead_id FROM public.broadcast_recipients br WHERE br.campaign_id = p_campaign);
  END IF;

  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.lg_enroll_broadcast(uuid,uuid,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lg_enroll_broadcast(uuid,uuid,int) TO authenticated, service_role;

-- Зачисляет только в АКТИВНУЮ кампанию (sending/scheduled); черновик не трогает.
CREATE OR REPLACE FUNCTION public.lg_enroll_active(p_project uuid, p_limit int DEFAULT 300)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _camp uuid;
BEGIN
  SELECT id INTO _camp FROM public.broadcast_campaigns
    WHERE project_id = p_project AND status IN ('sending','scheduled')
    ORDER BY created_at DESC LIMIT 1;
  IF _camp IS NULL THEN RETURN 0; END IF;
  RETURN public.lg_enroll_broadcast(p_project, _camp, p_limit);
END $$;
REVOKE EXECUTE ON FUNCTION public.lg_enroll_active(uuid,int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.lg_enroll_active(uuid,int) TO authenticated, service_role;
