-- Дозаполнить лиды в уже созданном «Аск Мед» без пересоздания проекта.
-- Запуск в SQL Editor (mekwfbqmsqiborjdrjxc):

CREATE OR REPLACE FUNCTION public.topup_ask_med_leads(
  p_project_id uuid DEFAULT 'cac7a9a2-d867-4558-8b9d-323e9098a985',
  p_target_leads int DEFAULT 95,
  p_month_start date DEFAULT '2026-06-01'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cabinet_id uuid;
  v_pipeline_id uuid;
  v_existing int;
  v_to_add int;
  v_start int;
BEGIN
  SELECT ac.id INTO v_cabinet_id
  FROM public.ad_cabinets ac
  WHERE ac.project_id = p_project_id
  ORDER BY ac.created_at
  LIMIT 1;

  IF v_cabinet_id IS NULL THEN
    RAISE EXCEPTION 'Нет кабинета у проекта %', p_project_id;
  END IF;

  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE project_id = p_project_id AND is_default = true
  LIMIT 1;

  PERFORM public.ensure_project_pipeline(p_project_id);

  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE project_id = p_project_id AND is_default = true
  LIMIT 1;

  SELECT COUNT(*)::int INTO v_existing FROM public.leads WHERE project_id = p_project_id;
  v_to_add := GREATEST(0, p_target_leads - v_existing);
  v_start := v_existing + 1;

  IF v_to_add > 0 THEN
    INSERT INTO public.leads (
      project_id, cabinet_id, pipeline_id, stage_id,
      name, phone, source, channel, meta_ad_id, meta_campaign_id,
      amount, diagnostic_amount, paid, paid_at, created_at, last_activity_at, city, service, ai_score
    )
    SELECT
      p_project_id,
      v_cabinet_id,
      v_pipeline_id,
      st.id,
      'Пациент ' || lpad((v_start + i - 1)::text, 3, '0'),
      '+7703' || lpad((3000000 + v_start + i)::text, 7, '0'),
      'meta',
      'whatsapp'::public.lead_channel,
      '990200' || (1 + ((v_start + i) % 8))::text,
      '990100' || (1 + ((v_start + i) % 3))::text,
      CASE WHEN (v_start + i) <= 92 THEN round(80000 + random() * 320000) ELSE 0 END,
      CASE WHEN (v_start + i) BETWEEN 41 AND 70 THEN round(12000 + random() * 18000) ELSE 0 END,
      (v_start + i) > 70 AND (v_start + i) <= 92,
      CASE WHEN (v_start + i) > 70 AND (v_start + i) <= 92
        THEN (p_month_start + (((v_start + i) % 26)) * interval '1 day')::timestamptz
        ELSE NULL END,
      (p_month_start + (((v_start + i) % 26)) * interval '1 day') + (random() * interval '12 hours'),
      (p_month_start + (((v_start + i) % 26)) * interval '1 day') + (random() * interval '18 hours'),
      'Алматы',
      CASE ((v_start + i) % 4) WHEN 0 THEN 'Имплантация' WHEN 1 THEN 'Виниры' WHEN 2 THEN 'Диагностика' ELSE 'Лечение' END,
      40 + (random() * 50)::int
    FROM generate_series(1, v_to_add) AS i
    JOIN LATERAL (
      SELECT ps.id
      FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = v_pipeline_id
        AND ps.key = CASE
          WHEN (v_start + i) <= 20 THEN 'new'
          WHEN (v_start + i) <= 40 THEN 'in_progress'
          WHEN (v_start + i) <= 55 THEN 'scheduled'
          WHEN (v_start + i) <= 70 THEN 'visit'
          WHEN (v_start + i) <= 92 THEN 'paid'
          ELSE 'rejected'
        END
      LIMIT 1
    ) st ON true;
  END IF;

  SELECT COUNT(*)::int INTO v_existing FROM public.leads WHERE project_id = p_project_id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', p_project_id,
    'leads_total', v_existing,
    'added', v_to_add
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.topup_ask_med_leads(uuid, int, date) TO service_role;

SELECT public.topup_ask_med_leads();
