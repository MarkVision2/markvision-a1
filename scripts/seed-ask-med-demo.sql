-- =============================================================================
-- Демо-проект «Аск Мед» — полный месяц (июнь 2026) для презентации платформы.
--
-- КУДА ЗАПУСКАТЬ: Supabase SQL Editor проекта MarkVision (mekwfbqmsqiborjdrjxc)
--   Lovable → Project Settings → Supabase → SQL Editor → New query → вставить весь файл → Run
--
-- Что делает:
--   1. Удаляет старый проект «Аск Мед» (если был) и создаёт заново
--   2. Копирует данные за июнь 2026 из «Стоматология Уали» (если есть), иначе — синтетика
--   3. Анонимизирует ФИО/телефоны, подменяет бренд на «Аск Мед»
--   4. Даёт доступ всем admin-пользователям
--
-- После запуска: переключите проект в шапке на «Аск Мед», период — июнь 2026.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seed_demo_project_ask_med(
  p_source_project_name text DEFAULT 'Стоматология Уали',
  p_month_start date DEFAULT '2026-06-01',
  p_month_end date DEFAULT '2026-06-30'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_demo_name text := 'Аск Мед';
  v_source_id uuid;
  v_source_name text;
  v_demo_id uuid;
  v_cabinet_id uuid;
  v_source_cabinet_id uuid;
  v_pipeline_id uuid;
  v_external_id text := 'act_demo_ask_med';
  v_cdi_count int := 0;
  v_leads_count int := 0;
  v_creatives_count int := 0;
  v_use_clone boolean := false;
  v_day date;
  v_spend numeric;
  v_meta_leads int;
  v_impr int;
  v_clicks int;
  i int;
  rec record;
  v_ad_demo text;
  v_camp_demo text;
BEGIN
  -- Источник для клонирования (точное имя → Уали → стоматология → проект с макс. лидами)
  SELECT p.id, p.name INTO v_source_id, v_source_name
  FROM public.projects p
  WHERE p.name <> v_demo_name
    AND (
      p.name ILIKE '%' || trim(p_source_project_name) || '%'
      OR p.name ILIKE '%уали%'
      OR p.name ILIKE '%стомат%'
    )
  ORDER BY
    CASE
      WHEN p.name ILIKE trim(p_source_project_name) THEN 0
      WHEN p.name ILIKE '%уали%' THEN 1
      ELSE 2
    END,
    p.created_at
  LIMIT 1;

  IF v_source_id IS NULL THEN
    SELECT p.id, p.name INTO v_source_id, v_source_name
    FROM public.projects p
    WHERE p.name <> v_demo_name
    ORDER BY (SELECT COUNT(*)::int FROM public.leads l WHERE l.project_id = p.id) DESC, p.created_at
    LIMIT 1;
  END IF;

  IF v_source_id IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_cdi_count
    FROM public.cabinet_daily_insights cdi
    JOIN public.ad_cabinets ac ON ac.id = cdi.cabinet_id
    WHERE ac.project_id = v_source_id
      AND cdi.date BETWEEN p_month_start AND p_month_end;
    v_use_clone := v_cdi_count > 0;
  END IF;

  -- Пересоздать демо-проект
  DELETE FROM public.projects WHERE name = v_demo_name;

  INSERT INTO public.projects (name, domain, initials, is_primary)
  VALUES (v_demo_name, 'askmed.demo', 'АМ', false)
  RETURNING id INTO v_demo_id;

  PERFORM public.ensure_project_pipeline(v_demo_id);

  SELECT id INTO v_pipeline_id
  FROM public.pipelines
  WHERE project_id = v_demo_id AND is_default = true
  LIMIT 1;

  -- Доступ: все admin + владельцы других проектов (чтобы демо видели на презентации)
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

  -- Демо-кабинет Meta
  INSERT INTO public.ad_cabinets (
    project_id, name, external_id, online, type, provider, spend, leads, sales, revenue
  ) VALUES (
    v_demo_id,
    'Meta Ads — Аск Мед (демо)',
    v_external_id,
    true,
    'Демо',
    'meta',
    0, 0, 0, 0
  )
  RETURNING id INTO v_cabinet_id;

  IF v_use_clone THEN
    -- Кабинет-источник
    SELECT ac.id INTO v_source_cabinet_id
    FROM public.ad_cabinets ac
    WHERE ac.project_id = v_source_id
    ORDER BY ac.spend DESC NULLS LAST, ac.created_at
    LIMIT 1;

    -- CDI за месяц
    INSERT INTO public.cabinet_daily_insights (
      cabinet_id, external_id, project_id, provider, date,
      spend, impressions, clicks, leads, revenue, currency,
      crm_diagnostics, crm_sales, crm_revenue, crm_diagnostic_revenue,
      ctr, cpc, cpm, cpl
    )
    SELECT
      v_cabinet_id,
      v_external_id,
      v_demo_id,
      COALESCE(cdi.provider, 'meta'),
      cdi.date,
      cdi.spend, cdi.impressions, cdi.clicks, cdi.leads, cdi.revenue,
      COALESCE(cdi.currency, 'KZT'),
      cdi.crm_diagnostics, cdi.crm_sales, cdi.crm_revenue, cdi.crm_diagnostic_revenue,
      cdi.ctr, cdi.cpc, cdi.cpm, cdi.cpl
    FROM public.cabinet_daily_insights cdi
    WHERE cdi.cabinet_id = v_source_cabinet_id
      AND cdi.date BETWEEN p_month_start AND p_month_end
    ON CONFLICT (external_id, date) DO UPDATE SET
      spend = EXCLUDED.spend,
      leads = EXCLUDED.leads,
      crm_sales = EXCLUDED.crm_sales,
      crm_revenue = EXCLUDED.crm_revenue,
      project_id = EXCLUDED.project_id,
      cabinet_id = EXCLUDED.cabinet_id;

    GET DIAGNOSTICS v_cdi_count = ROW_COUNT;

    -- Кампании
    FOR rec IN
      SELECT * FROM public.meta_campaigns WHERE project_id = v_source_id
    LOOP
      v_camp_demo := '990' || rec.campaign_id;
      INSERT INTO public.meta_campaigns (
        cabinet_id, project_id, campaign_id, name, objective, destination_type,
        status, effective_status, daily_budget
      ) VALUES (
        v_cabinet_id, v_demo_id, v_camp_demo,
        replace(rec.name, 'Уали', 'Аск Мед'),
        rec.objective, rec.destination_type, rec.status, rec.effective_status, rec.daily_budget
      )
      ON CONFLICT (campaign_id) DO NOTHING;

      INSERT INTO public.meta_campaign_daily (
        campaign_id, cabinet_id, project_id, date,
        spend, impressions, clicks, leads, messages, purchases, revenue, currency
      )
      SELECT
        v_camp_demo, v_cabinet_id, v_demo_id, mcd.date,
        mcd.spend, mcd.impressions, mcd.clicks, mcd.leads, mcd.messages, mcd.purchases, mcd.revenue,
        COALESCE(mcd.currency, 'KZT')
      FROM public.meta_campaign_daily mcd
      WHERE mcd.campaign_id = rec.campaign_id
        AND mcd.date BETWEEN p_month_start AND p_month_end
      ON CONFLICT (campaign_id, date) DO NOTHING;
    END LOOP;

    -- Креативы + дневная статистика
    FOR rec IN
      SELECT * FROM public.meta_creatives WHERE project_id = v_source_id
    LOOP
      v_ad_demo := '990' || rec.ad_id;
      v_camp_demo := CASE WHEN rec.campaign_id IS NOT NULL THEN '990' || rec.campaign_id ELSE NULL END;

      INSERT INTO public.meta_creatives (
        cabinet_id, project_id, ad_id, adset_id, campaign_id, name,
        status, effective_status, creative_type,
        thumbnail_url, image_url, poster_url, video_url, video_id,
        primary_text, headline, cta, destination_url
      ) VALUES (
        v_cabinet_id, v_demo_id, v_ad_demo, rec.adset_id, v_camp_demo,
        replace(replace(rec.name, 'Уали', 'Аск Мед'), 'уали', 'Аск Мед'),
        rec.status, rec.effective_status, COALESCE(rec.creative_type, 'video'),
        COALESCE(rec.poster_url, 'https://picsum.photos/seed/askmed-' || v_ad_demo || '/400/711'),
        COALESCE(rec.poster_url, rec.image_url, 'https://picsum.photos/seed/askmed-' || v_ad_demo || '/400/711'),
        COALESCE(rec.poster_url, 'https://picsum.photos/seed/askmed-' || v_ad_demo || '/720/1280'),
        rec.video_url, rec.video_id,
        rec.primary_text, rec.headline, rec.cta, rec.destination_url
      )
      ON CONFLICT (ad_id) DO UPDATE SET
        name = EXCLUDED.name,
        poster_url = EXCLUDED.poster_url,
        thumbnail_url = EXCLUDED.thumbnail_url,
        project_id = EXCLUDED.project_id;

      INSERT INTO public.meta_creative_daily (
        ad_id, cabinet_id, project_id, campaign_id, date,
        spend, impressions, clicks, leads, messages, purchases, revenue, currency
      )
      SELECT
        v_ad_demo, v_cabinet_id, v_demo_id, v_camp_demo, mcd.date,
        mcd.spend, mcd.impressions, mcd.clicks, mcd.leads, mcd.messages, mcd.purchases, mcd.revenue,
        COALESCE(mcd.currency, 'KZT')
      FROM public.meta_creative_daily mcd
      WHERE mcd.ad_id = rec.ad_id
        AND mcd.date BETWEEN p_month_start AND p_month_end
      ON CONFLICT (ad_id, date) DO NOTHING;
    END LOOP;

    SELECT COUNT(*)::int INTO v_creatives_count FROM public.meta_creatives WHERE project_id = v_demo_id;

    -- Лиды: клон за месяц с анонимизацией
    INSERT INTO public.leads (
      project_id, cabinet_id, pipeline_id, stage_id,
      name, phone, source, channel, campaign,
      meta_ad_id, meta_campaign_id, meta_adset_id,
      amount, diagnostic_amount, paid, paid_at,
      created_at, last_activity_at, city, service, ai_score
    )
    SELECT
      v_demo_id,
      v_cabinet_id,
      v_pipeline_id,
      COALESCE(
        (SELECT ps2.id FROM public.pipeline_stages ps2
         JOIN public.pipelines p2 ON p2.id = ps2.pipeline_id
         WHERE p2.project_id = v_demo_id
           AND ps2.key = src.stage_key
         LIMIT 1),
        (SELECT ps3.id FROM public.pipeline_stages ps3
         JOIN public.pipelines p3 ON p3.id = ps3.pipeline_id
         WHERE p3.project_id = v_demo_id
         ORDER BY ps3.order_index LIMIT 1)
      ),
      'Пациент ' || lpad(src.rn::text, 3, '0'),
      '+7701' || lpad((1000000 + (src.rn % 8999999))::text, 7, '0'),
      COALESCE(src.source, 'meta'),
      src.channel,
      replace(COALESCE(src.campaign, ''), 'Уали', 'Аск Мед'),
      CASE WHEN src.meta_ad_id IS NOT NULL THEN '990' || src.meta_ad_id ELSE NULL END,
      CASE WHEN src.meta_campaign_id IS NOT NULL THEN '990' || src.meta_campaign_id ELSE NULL END,
      src.meta_adset_id,
      src.amount,
      COALESCE(src.diagnostic_amount, 0),
      src.paid,
      src.paid_at,
      src.created_at,
      COALESCE(src.last_activity_at, src.created_at),
      'Алматы',
      COALESCE(src.service, 'Стоматология'),
      GREATEST(35, LEAST(95, COALESCE(src.ai_score, 50)))
    FROM (
      SELECT
        l.*,
        ps.key AS stage_key,
        row_number() OVER (ORDER BY l.created_at) AS rn
      FROM public.leads l
      LEFT JOIN public.pipeline_stages ps ON ps.id = l.stage_id
      WHERE l.project_id = v_source_id
        AND l.created_at::date BETWEEN p_month_start AND p_month_end
    ) src;

  ELSE
    -- Синтетические данные (если источник пустой)
    v_day := p_month_start;
    WHILE v_day <= p_month_end LOOP
      v_spend := 42000 + (random() * 38000)::numeric;
      v_meta_leads := 4 + (random() * 8)::int;
      v_impr := 12000 + (random() * 18000)::int;
      v_clicks := 180 + (random() * 320)::int;

      INSERT INTO public.cabinet_daily_insights (
        cabinet_id, external_id, project_id, provider, date,
        spend, impressions, clicks, leads, revenue, currency,
        crm_diagnostics, crm_sales, crm_revenue, crm_diagnostic_revenue,
        ctr, cpc, cpm, cpl
      ) VALUES (
        v_cabinet_id, v_external_id, v_demo_id, 'meta', v_day,
        round(v_spend), v_impr, v_clicks, v_meta_leads, 0, 'KZT',
        GREATEST(0, (v_meta_leads * 0.45)::int),
        GREATEST(0, (random() * 2)::int),
        CASE WHEN random() > 0.55 THEN round(120000 + random() * 280000) ELSE 0 END,
        CASE WHEN random() > 0.7 THEN round(15000 + random() * 35000) ELSE 0 END,
        round((v_clicks::numeric / NULLIF(v_impr, 0)) * 100, 2),
        round(v_spend / NULLIF(v_clicks, 0), 2),
        round((v_spend / NULLIF(v_impr, 0)) * 1000, 2),
        round(v_spend / NULLIF(v_meta_leads, 0), 2)
      )
      ON CONFLICT (external_id, date) DO NOTHING;

      v_day := v_day + 1;
    END LOOP;

    SELECT COUNT(*)::int INTO v_cdi_count
    FROM public.cabinet_daily_insights
    WHERE project_id = v_demo_id;

    -- 3 кампании
    INSERT INTO public.meta_campaigns (cabinet_id, project_id, campaign_id, name, objective, destination_type, effective_status, daily_budget)
    VALUES
      (v_cabinet_id, v_demo_id, '9901001', 'Аск Мед | WhatsApp лиды', 'OUTCOME_LEADS', 'WHATSAPP', 'ACTIVE', 25000),
      (v_cabinet_id, v_demo_id, '9901002', 'Аск Мед | Запись на диагностику', 'OUTCOME_LEADS', 'WEBSITE', 'ACTIVE', 18000),
      (v_cabinet_id, v_demo_id, '9901003', 'Аск Мед | Имплантация', 'OUTCOME_LEADS', 'WHATSAPP', 'PAUSED', 12000)
    ON CONFLICT (campaign_id) DO NOTHING;

    -- Дневная статистика кампаний
    v_day := p_month_start;
    WHILE v_day <= p_month_end LOOP
      INSERT INTO public.meta_campaign_daily (
        campaign_id, cabinet_id, project_id, date,
        spend, impressions, clicks, leads, messages, currency
      )
      SELECT
        c.campaign_id, v_cabinet_id, v_demo_id, v_day,
        round(3000 + random() * 12000),
        round(2000 + random() * 8000),
        round(30 + random() * 90),
        (1 + random() * 4)::int,
        (random() * 3)::int,
        'KZT'
      FROM public.meta_campaigns c
      WHERE c.project_id = v_demo_id
      ON CONFLICT (campaign_id, date) DO NOTHING;
      v_day := v_day + 1;
    END LOOP;

    -- 8 креативов
    FOR i IN 1..8 LOOP
      v_ad_demo := '990200' || i::text;
      v_camp_demo := CASE WHEN i <= 3 THEN '9901001' WHEN i <= 6 THEN '9901002' ELSE '9901003' END;

      INSERT INTO public.meta_creatives (
        cabinet_id, project_id, ad_id, campaign_id, name, creative_type, effective_status,
        thumbnail_url, image_url, poster_url, headline, primary_text
      ) VALUES (
        v_cabinet_id, v_demo_id, v_ad_demo, v_camp_demo,
        'ask_med_kreativ_' || i || ' | video | demo',
        'video',
        CASE WHEN i = 7 THEN 'ACTIVE' ELSE 'CAMPAIGN_PAUSED' END,
        'https://picsum.photos/seed/askmed' || i || '/400/711',
        'https://picsum.photos/seed/askmed' || i || '/400/711',
        'https://picsum.photos/seed/askmed' || i || '/720/1280',
        'Аск Мед — современная стоматология',
        'Запишитесь на бесплатную консультацию. Имплантация, эстетика, лечение под микроскопом.'
      )
      ON CONFLICT (ad_id) DO NOTHING;

      v_day := p_month_start;
      WHILE v_day <= p_month_end LOOP
        IF random() > 0.35 THEN
          v_spend := 800 + (random() * 4200);
          v_meta_leads := (random() * 3)::int;
          INSERT INTO public.meta_creative_daily (
            ad_id, cabinet_id, project_id, campaign_id, date,
            spend, impressions, clicks, leads, currency
          ) VALUES (
            v_ad_demo, v_cabinet_id, v_demo_id, v_camp_demo, v_day,
            round(v_spend), round(800 + random() * 4000), round(10 + random() * 40),
            v_meta_leads, 'KZT'
          )
          ON CONFLICT (ad_id, date) DO NOTHING;
        END IF;
        v_day := v_day + 1;
      END LOOP;
    END LOOP;

    SELECT COUNT(*)::int INTO v_creatives_count FROM public.meta_creatives WHERE project_id = v_demo_id;

    -- ~95 лидов (bulk insert — надёжнее цикла)
    INSERT INTO public.leads (
      project_id, cabinet_id, pipeline_id, stage_id,
      name, phone, source, channel, meta_ad_id, meta_campaign_id,
      amount, diagnostic_amount, paid, paid_at, created_at, last_activity_at, city, service, ai_score
    )
    SELECT
      v_demo_id,
      v_cabinet_id,
      v_pipeline_id,
      st.id,
      'Пациент ' || lpad(i::text, 3, '0'),
      '+7702' || lpad((2000000 + i)::text, 7, '0'),
      'meta',
      'whatsapp'::public.lead_channel,
      '990200' || (1 + (i % 8))::text,
      '990100' || (1 + (i % 3))::text,
      CASE WHEN i <= 92 THEN round(80000 + random() * 320000) ELSE 0 END,
      CASE WHEN i BETWEEN 41 AND 70 THEN round(12000 + random() * 18000) ELSE 0 END,
      i > 70 AND i <= 92,
      CASE WHEN i > 70 AND i <= 92 THEN (p_month_start + ((i % 26)) * interval '1 day')::timestamptz ELSE NULL END,
      (p_month_start + ((i % 26)) * interval '1 day') + (random() * interval '12 hours'),
      (p_month_start + ((i % 26)) * interval '1 day') + (random() * interval '18 hours'),
      'Алматы',
      CASE (i % 4) WHEN 0 THEN 'Имплантация' WHEN 1 THEN 'Виниры' WHEN 2 THEN 'Диагностика' ELSE 'Лечение' END,
      40 + (random() * 50)::int
    FROM generate_series(1, 95) AS i
    JOIN LATERAL (
      SELECT ps.id
      FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = v_pipeline_id
        AND ps.key = CASE
          WHEN i <= 20 THEN 'new'
          WHEN i <= 40 THEN 'in_progress'
          WHEN i <= 55 THEN 'scheduled'
          WHEN i <= 70 THEN 'visit'
          WHEN i <= 92 THEN 'paid'
          ELSE 'rejected'
        END
      LIMIT 1
    ) st ON true;
  END IF;

  -- РНП за месяц
  v_day := p_month_start;
  WHILE v_day <= p_month_end LOOP
    INSERT INTO public.rnp_daily (
      project_id, date, diag_revenue, planned_diagnostics, conducted_diagnostics,
      prepayments_count, prepayments_sum, cash_received
    ) VALUES (
      v_demo_id, v_day,
      round(20000 + random() * 60000),
      2 + (random() * 4)::int,
      1 + (random() * 3)::int,
      (random() * 2)::int,
      round(random() * 80000),
      round(random() * 150000)
    );
    v_day := v_day + 1;
  END LOOP;

  -- Итоги кабинета
  UPDATE public.ad_cabinets ac SET
    spend = COALESCE((SELECT SUM(cdi.spend) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0),
    leads = COALESCE((SELECT SUM(cdi.leads) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0),
    sales = COALESCE((SELECT SUM(cdi.crm_sales) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0),
    revenue = COALESCE((SELECT SUM(cdi.crm_revenue) FROM public.cabinet_daily_insights cdi WHERE cdi.cabinet_id = ac.id), 0)
  WHERE ac.id = v_cabinet_id;

  SELECT COUNT(*)::int INTO v_cdi_count
  FROM public.cabinet_daily_insights WHERE project_id = v_demo_id;

  SELECT COUNT(*)::int INTO v_leads_count
  FROM public.leads WHERE project_id = v_demo_id;

  SELECT COUNT(*)::int INTO v_creatives_count
  FROM public.meta_creatives WHERE project_id = v_demo_id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', v_demo_id,
    'project_name', v_demo_name,
    'mode', CASE WHEN v_use_clone THEN 'cloned' ELSE 'synthetic' END,
    'source_project', COALESCE(v_source_name, p_source_project_name),
    'source_found', v_source_id IS NOT NULL,
    'source_used_for_clone', v_use_clone,
    'month', jsonb_build_object('from', p_month_start, 'to', p_month_end),
    'counts', jsonb_build_object(
      'cdi_days', v_cdi_count,
      'creatives', v_creatives_count,
      'leads', v_leads_count
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_project_ask_med(text, date, date) TO service_role;

-- ▶ ЗАПУСК (раскомментируйте одну строку после вставки в SQL Editor):

SELECT public.seed_demo_project_ask_med();

-- Или с другим источником:
-- SELECT public.seed_demo_project_ask_med('Стоматология Уали', '2026-06-01', '2026-06-30');
