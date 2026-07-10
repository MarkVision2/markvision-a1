-- ============================================================
-- CAPI Settings UI — редактируемая настройка Meta CAPI прямо из CRM.
--
-- Что закрывает:
--   1. Колонка ad_cabinets.capi_test_event_code — воркер (capi-outbox-worker)
--      уже её читает, но ни одна миграция её не создавала. Без неё UI не может
--      сохранить Test Event Code и «тестовые» события не попадают в Meta Test Events.
--   2. crm_stage_map — раньше PK был по одному status_key, из-за чего два разных
--      проекта с одинаковым названием стадии ('оплата') конфликтовали и не могли
--      иметь СВОЙ маппинг. Делаем маппинг честно per-project:
--        - суррогатный id как PK,
--        - партиальные unique-индексы: одна глобальная строка на ключ (project_id IS NULL)
--          и одна строка на (ключ, проект). Так проектный override живёт рядом с глобальным,
--          а триггер on_lead_stage_change_capi (ORDER BY project_id NULLS LAST) берёт
--          проектный в приоритете.
-- ============================================================

-- 1) Test Event Code на кабинет — для проверки «работает и передаёт данные».
ALTER TABLE public.ad_cabinets
  ADD COLUMN IF NOT EXISTS capi_test_event_code text;

-- 2) crm_stage_map → per-project mapping.
DO $$
BEGIN
  -- Суррогатный ключ (если ещё нет).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'crm_stage_map' AND column_name = 'id'
  ) THEN
    ALTER TABLE public.crm_stage_map ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
  END IF;

  -- Снимаем старый PK по status_key, ставим PK по id.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.crm_stage_map'::regclass AND contype = 'p' AND conname = 'crm_stage_map_pkey'
  ) THEN
    -- Проверяем, что PK действительно по status_key (а не уже по id).
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'public.crm_stage_map'::regclass AND c.contype = 'p'
        AND a.attname = 'status_key'
    ) THEN
      ALTER TABLE public.crm_stage_map DROP CONSTRAINT crm_stage_map_pkey;
      ALTER TABLE public.crm_stage_map ADD CONSTRAINT crm_stage_map_pkey PRIMARY KEY (id);
    END IF;
  ELSE
    ALTER TABLE public.crm_stage_map ADD CONSTRAINT crm_stage_map_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- Композитная уникальность (status_key, project_id). Обычный (не партиальный) индекс —
-- чтобы PostgREST мог использовать его как arbiter в upsert onConflict:"status_key,project_id".
-- NULL-проекты (глобальные строки) в PG считаются distinct, поэтому не конфликтуют между собой.
CREATE UNIQUE INDEX IF NOT EXISTS crm_stage_map_key_project_uniq
  ON public.crm_stage_map (status_key, project_id);

-- Дополнительно гарантируем «одна глобальная строка на ключ» (другой набор колонок —
-- с upsert по (status_key, project_id) не конфликтует).
CREATE UNIQUE INDEX IF NOT EXISTS crm_stage_map_global_key_uniq
  ON public.crm_stage_map (status_key)
  WHERE project_id IS NULL;

-- Realtime для crm_stage_map, чтобы панель CAPI видела чужие правки без перезагрузки.
ALTER TABLE public.crm_stage_map REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'crm_stage_map'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_stage_map';
  END IF;
END $$;
