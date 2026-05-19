
CREATE OR REPLACE FUNCTION public.cabinet_health_check(p_cabinet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cab record;
  v_project uuid;
  v_meta_token text;
  v_wa record;
  v_stage_map_count int;
  v_last_sync timestamptz;
  v_capi_pending int;
  v_capi_stuck int;
  v_checks jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_cab FROM public.ad_cabinets WHERE id = p_cabinet_id;
  IF v_cab IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cabinet_not_found');
  END IF;

  v_project := v_cab.project_id;

  -- Access guard
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.user_can_access_project(v_project)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- 1. Meta token: кабинетный access_token ИЛИ глобальный automation_settings.meta_access_token
  SELECT meta_access_token INTO v_meta_token FROM public.automation_settings WHERE id = true;
  v_checks := v_checks || jsonb_build_object(
    'key', 'meta_token',
    'label', 'Meta access token',
    'ok', (COALESCE(v_cab.access_token, '') <> '' OR COALESCE(v_meta_token, '') <> ''),
    'detail', CASE
      WHEN COALESCE(v_cab.access_token,'') <> '' THEN 'token на кабинете'
      WHEN COALESCE(v_meta_token,'') <> ''     THEN 'глобальный token'
      ELSE 'нет токена'
    END
  );

  -- 2. GreenAPI: whatsapp_config для проекта
  SELECT id_instance, api_token, connected, webhook_url
    INTO v_wa
    FROM public.whatsapp_config
   WHERE project_id = v_project
   LIMIT 1;
  v_checks := v_checks || jsonb_build_object(
    'key', 'greenapi',
    'label', 'GreenAPI instance',
    'ok', (v_wa.id_instance IS NOT NULL AND v_wa.id_instance <> ''),
    'detail', CASE WHEN v_wa.id_instance IS NULL THEN 'не подключён'
                   WHEN COALESCE(v_wa.connected,false) THEN 'подключён'
                   ELSE 'instance задан, не подтверждён' END
  );

  -- 3. Webhook URL прописан
  v_checks := v_checks || jsonb_build_object(
    'key', 'webhook',
    'label', 'GreenAPI webhook',
    'ok', (COALESCE(v_wa.webhook_url, '') <> ''),
    'detail', COALESCE(NULLIF(v_wa.webhook_url, ''), 'не настроен')
  );

  -- 4. CRM stage map: есть хотя бы 1 правило (project-specific или global)
  SELECT COUNT(*) INTO v_stage_map_count
    FROM public.crm_stage_map
   WHERE project_id IS NULL OR project_id = v_project;
  v_checks := v_checks || jsonb_build_object(
    'key', 'stage_map',
    'label', 'CRM → CAPI mapping',
    'ok', (v_stage_map_count > 0),
    'detail', v_stage_map_count || ' правил'
  );

  -- 5. Свежесть structure sync (последний успешный <= 24h)
  SELECT MAX(finished_at) INTO v_last_sync
    FROM public.ad_sync_runs
   WHERE cabinet_id = p_cabinet_id
     AND kind = 'structure_sync'
     AND status = 'success';
  v_checks := v_checks || jsonb_build_object(
    'key', 'structure_sync',
    'label', 'Meta structure sync',
    'ok', (v_last_sync IS NOT NULL AND v_last_sync > now() - interval '24 hours'),
    'detail', CASE WHEN v_last_sync IS NULL THEN 'не запускался'
                   ELSE 'последний: ' || to_char(v_last_sync at time zone 'Asia/Almaty', 'DD.MM HH24:MI') END
  );

  -- 6. CAPI outbox: нет зависших > 1h в статусе pending
  BEGIN
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending'),
      COUNT(*) FILTER (WHERE status = 'pending' AND created_at < now() - interval '1 hour')
      INTO v_capi_pending, v_capi_stuck
      FROM public.capi_outbox
     WHERE cabinet_id = p_cabinet_id;
  EXCEPTION WHEN OTHERS THEN
    v_capi_pending := 0; v_capi_stuck := 0;
  END;
  v_checks := v_checks || jsonb_build_object(
    'key', 'capi_outbox',
    'label', 'CAPI outbox',
    'ok', (v_capi_stuck = 0),
    'detail', CASE WHEN v_capi_stuck > 0
      THEN v_capi_stuck || ' застряли (>1ч)'
      ELSE v_capi_pending || ' в очереди' END
  );

  RETURN jsonb_build_object(
    'ok', true,
    'cabinet_id', p_cabinet_id,
    'project_id', v_project,
    'checked_at', now(),
    'checks', v_checks
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cabinet_health_check(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cabinet_health_check(uuid) TO authenticated;
