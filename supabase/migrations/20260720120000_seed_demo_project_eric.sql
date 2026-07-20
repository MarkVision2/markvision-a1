-- =============================================================================
-- Демо-проект «Эрик» — полный июль 2026 для презентации платформы.
--
-- КУДА ЗАПУСКАТЬ: Supabase SQL Editor (prod szfgdruhlebfvcmlvxdk)
--   Dashboard → SQL → New query → вставить → Run
--
-- Целевые KPI за июль:
--   Расход рекламы:  540 000 ₸
--   Лиды (Meta):     270  (CPL = 2 000 ₸)
--   Продажи:         18
--   Доход:           4 734 000 ₸  (18 × 263 000)
--
-- После запуска: переключите проект в шапке на «Эрик», период — июль 2026.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seed_demo_project_eric(
  p_month_start date DEFAULT '2026-07-01',
  p_month_end date DEFAULT '2026-07-31'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo_name text := 'Эрик';
  v_demo_id uuid;
  v_cabinet_id uuid;
  v_pipeline_id uuid;
  v_external_id text := 'act_demo_eric';
  v_day date;
  v_days int;
  v_day_idx int;
  v_spend numeric;
  v_leads int;
  v_impr int;
  v_clicks int;
  v_cdi_count int := 0;
  v_leads_count int := 0;
  v_creatives_count int := 0;
  v_total_spend numeric := 540000;
  v_total_leads int := 270;
  v_total_revenue numeric := 4734000;
  v_sale_amount numeric := 263000;
  v_total_sales int := 18;
  i int;
  rec record;
  v_ad_demo text;
  v_camp_demo text;
BEGIN
  v_days := (p_month_end - p_month_start) + 1;

  -- Найти или создать проект
  SELECT id INTO v_demo_id FROM public.projects WHERE name ILIKE v_demo_name LIMIT 1;

  IF v_demo_id IS NULL THEN
    INSERT INTO public.projects (name, domain, initials, is_primary)
    VALUES (v_demo_name, 'eric.demo', 'ЭР', false)
    RETURNING id INTO v_demo_id;
  END IF;

  PERFORM public.ensure_project_pipeline(v_demo_id);

  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE project_id = v_demo_id AND is_default = true
  LIMIT 1;

  -- Доступ всем admin
  INSERT INTO public.project_members (project_id, user_id, role)
  SELECT v_demo_id, ur.user_id, 'owner'
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ON CONFLICT (project_id, user_id) DO NOTHING;

  INSERT INTO public.project_members (project_id, user_id, role)
  SELECT v_demo_id, pm.user_id, 'member'
  FROM public.project_members pm
  WHERE pm.role = 'owner'
  ON CONFLICT (project_id, user_id) DO NOTHING;

  -- Очистка демо-данных проекта за месяц (и старых демо-лидов)
  DELETE FROM public.communications
  WHERE lead_id IN (SELECT id FROM public.leads WHERE project_id = v_demo_id);

  DELETE FROM public.tasks
  WHERE lead_id IN (SELECT id FROM public.leads WHERE project_id = v_demo_id);

  DELETE FROM public.leads WHERE project_id = v_demo_id;

  DELETE FROM public.meta_creative_daily WHERE project_id = v_demo_id;
  DELETE FROM public.meta_creatives WHERE project_id = v_demo_id;
  DELETE FROM public.meta_campaign_daily WHERE project_id = v_demo_id;
  DELETE FROM public.meta_campaigns WHERE project_id = v_demo_id;

  DELETE FROM public.cabinet_daily_insights
  WHERE project_id = v_demo_id
    AND date BETWEEN p_month_start AND p_month_end;

  DELETE FROM public.rnp_daily
  WHERE project_id = v_demo_id
    AND date BETWEEN p_month_start AND p_month_end;

  -- Кабинет Meta (демо)
  SELECT id INTO v_cabinet_id
  FROM public.ad_cabinets
  WHERE project_id = v_demo_id AND external_id = v_external_id
  LIMIT 1;

  IF v_cabinet_id IS NULL THEN
    INSERT INTO public.ad_cabinets (
      project_id, name, external_id, online, type, provider, spend, leads, sales, revenue
    ) VALUES (
      v_demo_id,
      'Meta Ads — Эрик (демо)',
      v_external_id,
      true,
      'Демо',
      'meta',
      0, 0, 0, 0
    )
    RETURNING id INTO v_cabinet_id;
  ELSE
    UPDATE public.ad_cabinets SET
      name = 'Meta Ads — Эрик (демо)',
      online = true,
      spend = 0, leads = 0, sales = 0, revenue = 0
    WHERE id = v_cabinet_id;
  END IF;

  -- CDI: ровно 540 000 ₸ и 270 лидов за месяц (CPL = 2 000 ₸)
  v_day := p_month_start;
  v_day_idx := 0;
  WHILE v_day <= p_month_end LOOP
    v_day_idx := v_day_idx + 1;
    -- 540000 = 31×17419 + 11 → первые 11 дней +1 ₸
    v_spend := floor(v_total_spend / v_days)
      + CASE WHEN v_day_idx <= (v_total_spend - floor(v_total_spend / v_days) * v_days) THEN 1 ELSE 0 END;
    -- 270 = 31×8 + 22 → первые 22 дня +1 лид
    v_leads := floor(v_total_leads::numeric / v_days)
      + CASE WHEN v_day_idx <= (v_total_leads - floor(v_total_leads::numeric / v_days) * v_days) THEN 1 ELSE 0 END;
    v_impr := 14000 + (v_day_idx * 137) % 9000;
    v_clicks := 200 + (v_day_idx * 23) % 280;

    INSERT INTO public.cabinet_daily_insights (
      cabinet_id, external_id, project_id, provider, date,
      spend, impressions, clicks, leads, revenue, currency,
      crm_diagnostics, crm_sales, crm_revenue, crm_diagnostic_revenue,
      ctr, cpc, cpm, cpl
    ) VALUES (
      v_cabinet_id, v_external_id, v_demo_id, 'meta', v_day,
      v_spend, v_impr, v_clicks, v_leads, 0, 'KZT',
      0, 0, 0, 0,
      round((v_clicks::numeric / NULLIF(v_impr, 0)) * 100, 2),
      round(v_spend / NULLIF(v_clicks, 0), 2),
      round((v_spend / NULLIF(v_impr, 0)) * 1000, 2),
      round(v_spend / NULLIF(v_leads, 0), 2)
    )
    ON CONFLICT (external_id, date) DO UPDATE SET
      spend = EXCLUDED.spend,
      leads = EXCLUDED.leads,
      cpl = EXCLUDED.cpl,
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      project_id = EXCLUDED.project_id,
      cabinet_id = EXCLUDED.cabinet_id;

    v_day := v_day + 1;
  END LOOP;

  -- 3 кампании Meta
  INSERT INTO public.meta_campaigns (
    cabinet_id, project_id, campaign_id, name, objective, destination_type, effective_status, daily_budget
  ) VALUES
    (v_cabinet_id, v_demo_id, '8801001', 'Эрик | WhatsApp лиды', 'OUTCOME_LEADS', 'WHATSAPP', 'ACTIVE', 22000),
    (v_cabinet_id, v_demo_id, '8801002', 'Эрик | Запись на консультацию', 'OUTCOME_LEADS', 'WEBSITE', 'ACTIVE', 16000),
    (v_cabinet_id, v_demo_id, '8801003', 'Эрик | Ретаргет', 'OUTCOME_LEADS', 'WHATSAPP', 'PAUSED', 10000)
  ON CONFLICT (campaign_id) DO UPDATE SET
    name = EXCLUDED.name,
    project_id = EXCLUDED.project_id,
    cabinet_id = EXCLUDED.cabinet_id;

  -- Дневная статистика кампаний (пропорционально CDI)
  v_day := p_month_start;
  v_day_idx := 0;
  WHILE v_day <= p_month_end LOOP
    v_day_idx := v_day_idx + 1;
    v_spend := floor(v_total_spend / v_days)
      + CASE WHEN v_day_idx <= (v_total_spend - floor(v_total_spend / v_days) * v_days) THEN 1 ELSE 0 END;
    v_leads := floor(v_total_leads::numeric / v_days)
      + CASE WHEN v_day_idx <= (v_total_leads - floor(v_total_leads::numeric / v_days) * v_days) THEN 1 ELSE 0 END;

    INSERT INTO public.meta_campaign_daily (
      campaign_id, cabinet_id, project_id, date,
      spend, impressions, clicks, leads, messages, currency
    ) VALUES
      ('8801001', v_cabinet_id, v_demo_id, v_day,
       round(v_spend * 0.45), round(6000 + v_day_idx * 50), round(90 + v_day_idx % 40),
       round(v_leads * 0.5)::int, round(v_leads * 0.3)::int, 'KZT'),
      ('8801002', v_cabinet_id, v_demo_id, v_day,
       round(v_spend * 0.35), round(5000 + v_day_idx * 40), round(70 + v_day_idx % 30),
       round(v_leads * 0.35)::int, round(v_leads * 0.2)::int, 'KZT'),
      ('8801003', v_cabinet_id, v_demo_id, v_day,
       round(v_spend * 0.20), round(3000 + v_day_idx * 30), round(40 + v_day_idx % 20),
       (v_leads - round(v_leads * 0.5)::int - round(v_leads * 0.35)::int), 0, 'KZT')
    ON CONFLICT (campaign_id, date) DO NOTHING;

    v_day := v_day + 1;
  END LOOP;

  -- 8 креативов
  FOR i IN 1..8 LOOP
    v_ad_demo := '880200' || i::text;
    v_camp_demo := CASE WHEN i <= 3 THEN '8801001' WHEN i <= 6 THEN '8801002' ELSE '8801003' END;

    INSERT INTO public.meta_creatives (
      cabinet_id, project_id, ad_id, campaign_id, name, creative_type, effective_status,
      thumbnail_url, image_url, poster_url, headline, primary_text, cta
    ) VALUES (
      v_cabinet_id, v_demo_id, v_ad_demo, v_camp_demo,
      'eric_kreativ_' || i || ' | video | demo',
      'video',
      CASE WHEN i <= 5 THEN 'ACTIVE' ELSE 'CAMPAIGN_PAUSED' END,
      'https://picsum.photos/seed/eric' || i || '/400/711',
      'https://picsum.photos/seed/eric' || i || '/400/711',
      'https://picsum.photos/seed/eric' || i || '/720/1280',
      'Эрик — консультация и разбор',
      'Запишитесь на бесплатную консультацию. Разберём вашу ситуацию и составим план.',
      'Написать в WhatsApp'
    )
    ON CONFLICT (ad_id) DO UPDATE SET
      name = EXCLUDED.name,
      project_id = EXCLUDED.project_id,
      cabinet_id = EXCLUDED.cabinet_id;

    v_day := p_month_start;
    v_day_idx := 0;
    WHILE v_day <= p_month_end LOOP
      v_day_idx := v_day_idx + 1;
      IF (v_day_idx + i) % 3 <> 0 THEN
        v_spend := 600 + ((v_day_idx * i * 97) % 3800);
        v_leads := (v_day_idx + i) % 4;
        INSERT INTO public.meta_creative_daily (
          ad_id, cabinet_id, project_id, campaign_id, date,
          spend, impressions, clicks, leads, currency
        ) VALUES (
          v_ad_demo, v_cabinet_id, v_demo_id, v_camp_demo, v_day,
          round(v_spend), round(700 + v_day_idx * 30), round(12 + v_day_idx % 25),
          v_leads, 'KZT'
        )
        ON CONFLICT (ad_id, date) DO NOTHING;
      END IF;
      v_day := v_day + 1;
    END LOOP;
  END LOOP;

  SELECT COUNT(*)::int INTO v_creatives_count FROM public.meta_creatives WHERE project_id = v_demo_id;

  -- 270 лидов: воронка + 18 продаж на 4 734 000 ₸
  INSERT INTO public.leads (
    project_id, cabinet_id, pipeline_id, stage_id,
    name, phone, source, channel, campaign,
    meta_ad_id, meta_campaign_id,
    amount, diagnostic_amount, paid, paid_at,
    created_at, last_activity_at, first_response_at,
    city, service, ai_score, temperature, tags
  )
  SELECT
    v_demo_id,
    v_cabinet_id,
    v_pipeline_id,
    st.id,
    CASE
      WHEN i % 7 = 0 THEN 'Айгуль ' || (i % 100)
      WHEN i % 5 = 0 THEN 'Данияр ' || (i % 100)
      ELSE 'Клиент ' || lpad(i::text, 3, '0')
    END,
    '+7705' || lpad((3000000 + i)::text, 7, '0'),
    'meta',
    'whatsapp'::public.lead_channel,
    CASE (i % 3) WHEN 0 THEN 'Эрик | WhatsApp лиды' WHEN 1 THEN 'Эрик | Запись' ELSE 'Эрик | Ретаргет' END,
    '880200' || (1 + (i % 8))::text,
    '880100' || (1 + (i % 3))::text,
    CASE WHEN i BETWEEN 253 AND 270 THEN v_sale_amount ELSE 0 END,
    CASE WHEN i BETWEEN 199 AND 252 THEN round(18000 + (i % 7) * 1200) ELSE 0 END,
    i BETWEEN 253 AND 270,
    CASE WHEN i BETWEEN 253 AND 270
      THEN (p_month_start + ((i - 253) % v_days) * interval '1 day' + interval '14 hours')::timestamptz
      ELSE NULL
    END,
    (p_month_start + ((i - 1) % v_days) * interval '1 day' + (random() * interval '10 hours'))::timestamptz,
    (p_month_start + ((i - 1) % v_days) * interval '1 day' + interval '2 hours' + (random() * interval '4 hours'))::timestamptz,
    CASE (i % 4) WHEN 0 THEN 'Алматы' WHEN 1 THEN 'Астана' WHEN 2 THEN 'Шымкент' ELSE 'Караганда' END,
    CASE (i % 5) WHEN 0 THEN 'Консультация' WHEN 1 THEN 'Курс' WHEN 2 THEN 'Менторство' WHEN 3 THEN 'Разбор' ELSE 'Диагностика' END,
    42 + (i % 48),
    CASE WHEN i % 9 = 0 THEN 'hot' WHEN i % 3 = 0 THEN 'warm' ELSE 'cold' END,
    CASE WHEN i % 6 = 0 THEN ARRAY['vip']::text[] ELSE ARRAY[]::text[]
  FROM generate_series(1, v_total_leads) AS i
  JOIN LATERAL (
    SELECT ps.id
    FROM public.pipeline_stages ps
    WHERE ps.pipeline_id = v_pipeline_id
      AND ps.key = CASE
        WHEN i <= 45 THEN 'new'
        WHEN i <= 70 THEN 'no_answer'
        WHEN i <= 110 THEN 'in_progress'
        WHEN i <= 145 THEN 'scheduled'
        WHEN i <= 198 THEN 'visit'
        WHEN i <= 252 THEN 'invoice'
        WHEN i <= 270 THEN 'paid'
        ELSE 'rejected'
      END
    LIMIT 1
  ) st ON true;

  -- Пересчёт CRM → CDI (продажи/диагностики по дням)
  PERFORM public.reconcile_cdi_for_project(v_demo_id, p_month_start);

  -- РНП за месяц
  v_day := p_month_start;
  WHILE v_day <= p_month_end LOOP
    INSERT INTO public.rnp_daily (
      project_id, date, diag_revenue, planned_diagnostics, conducted_diagnostics,
      prepayments_count, prepayments_sum, cash_received
    ) VALUES (
      v_demo_id, v_day,
      round(35000 + (extract(day from v_day)::int % 5) * 8000),
      3 + (extract(day from v_day)::int % 3),
      2 + (extract(day from v_day)::int % 2),
      (extract(day from v_day)::int % 3),
      round(60000 + (extract(day from v_day)::int % 7) * 15000),
      round(120000 + (extract(day from v_day)::int % 11) * 25000)
    );
    v_day := v_day + 1;
  END LOOP;

  -- План и цель на июль
  INSERT INTO public.revenue_plan (project_id, month_key, value)
  VALUES (v_demo_id, to_char(p_month_start, 'YYYY-MM'), v_total_revenue)
  ON CONFLICT (project_id, month_key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.finance_plans (
    project_id, month_key, spend, leads, cpl, visits, sales, revenue,
    cr_lead_visit, cr_visit_sale, avg_check
  ) VALUES (
    v_demo_id, to_char(p_month_start, 'YYYY-MM'),
    v_total_spend, v_total_leads, 2000,
    54, v_total_sales, v_total_revenue,
    0.20, 0.33, v_sale_amount
  )
  ON CONFLICT (project_id, month_key) DO UPDATE SET
    spend = EXCLUDED.spend,
    leads = EXCLUDED.leads,
    cpl = EXCLUDED.cpl,
    visits = EXCLUDED.visits,
    sales = EXCLUDED.sales,
    revenue = EXCLUDED.revenue;

  INSERT INTO public.monthly_finance (project_id, month_key, revenue, spend)
  VALUES (v_demo_id, to_char(p_month_start, 'YYYY-MM'), v_total_revenue, v_total_spend)
  ON CONFLICT (project_id, month_key) DO UPDATE SET
    revenue = EXCLUDED.revenue,
    spend = EXCLUDED.spend;

  -- Диалоги WhatsApp для активных лидов (оживляет CRM)
  FOR rec IN
    SELECT l.id, l.name, l.created_at
    FROM public.leads l
    JOIN public.pipeline_stages ps ON ps.id = l.stage_id
    WHERE l.project_id = v_demo_id
      AND ps.key IN ('in_progress', 'scheduled', 'visit')
    ORDER BY l.created_at
    LIMIT 40
  LOOP
    INSERT INTO public.communications (lead_id, type, channel, direction, content, status, created_at)
    VALUES
      (rec.id, 'message', 'whatsapp', 'in',
       'Здравствуйте! Увидел рекламу, хочу узнать подробнее', 'delivered',
       rec.created_at + interval '5 minutes'),
      (rec.id, 'message', 'whatsapp', 'out',
       'Добрый день! Расскажите, что вас интересует?', 'delivered',
       rec.created_at + interval '12 minutes'),
      (rec.id, 'message', 'whatsapp', 'in',
       'Интересует консультация и формат работы', 'delivered',
       rec.created_at + interval '25 minutes');
  END LOOP;

  -- Итоги кабинета
  UPDATE public.ad_cabinets ac SET
    spend = COALESCE((SELECT SUM(cdi.spend) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0),
    leads = COALESCE((SELECT SUM(cdi.leads) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0),
    sales = COALESCE((SELECT SUM(cdi.crm_sales) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0),
    revenue = COALESCE((SELECT SUM(cdi.crm_revenue) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0)
  WHERE ac.id = v_cabinet_id;

  SELECT COUNT(*)::int INTO v_cdi_count
  FROM public.cabinet_daily_insights
  WHERE project_id = v_demo_id AND date BETWEEN p_month_start AND p_month_end;

  SELECT COUNT(*)::int INTO v_leads_count
  FROM public.leads WHERE project_id = v_demo_id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', v_demo_id,
    'project_name', v_demo_name,
    'month', jsonb_build_object('from', p_month_start, 'to', p_month_end),
    'kpi', jsonb_build_object(
      'spend', v_total_spend,
      'leads', v_total_leads,
      'cpl', round(v_total_spend / v_total_leads, 2),
      'sales', v_total_sales,
      'revenue', v_total_revenue
    ),
    'counts', jsonb_build_object(
      'cdi_days', v_cdi_count,
      'creatives', v_creatives_count,
      'leads', v_leads_count
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_project_eric(date, date) TO service_role;

-- ▶ ЗАПУСК:
SELECT public.seed_demo_project_eric();

-- Или другой месяц:
-- SELECT public.seed_demo_project_eric('2026-07-01', '2026-07-31');
