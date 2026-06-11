-- Дозаполнение stage_changed: обогатить старые события + вставить пропущенные из истории.
-- Запускать если после 20260603120000: to_key IS NULL и backfilled = 0.

-- =============================================================================
-- 1) Обогатить существующие stage_changed (UUID → key в payload)
-- =============================================================================
UPDATE public.events e
SET payload = e.payload || jsonb_build_object(
  'from_key', (
    SELECT ps.key FROM public.pipeline_stages ps
    WHERE ps.id::text = e.payload->>'from'
  ),
  'to_key', (
    SELECT ps.key FROM public.pipeline_stages ps
    WHERE ps.id::text = e.payload->>'to'
  ),
  'to_is_diagnostic', COALESCE((
    SELECT ps.is_diagnostic FROM public.pipeline_stages ps
    WHERE ps.id::text = e.payload->>'to'
  ), false)
)
WHERE e.event_type = 'stage_changed'
  AND e.payload->>'to' IS NOT NULL
  AND e.payload->>'to_key' IS NULL;

-- =============================================================================
-- 2) Вставить из lead_status_history, если нет пары (lead_id, to_stage_id)
--    (мягче, чем ±2 мин в первой миграции)
-- =============================================================================
INSERT INTO public.events (lead_id, event_type, payload, actor_id, created_at)
SELECT
  h.lead_id,
  'stage_changed',
  jsonb_build_object(
    'from', h.from_stage_id,
    'to', h.to_stage_id,
    'from_key', fs.key,
    'to_key', ts.key,
    'to_is_diagnostic', COALESCE(ts.is_diagnostic, false),
    'source', 'lead_status_history_backfill_v2'
  ),
  h.changed_by,
  h.changed_at
FROM public.lead_status_history h
JOIN public.pipeline_stages ts ON ts.id = h.to_stage_id
LEFT JOIN public.pipeline_stages fs ON fs.id = h.from_stage_id
WHERE h.from_stage_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.lead_id = h.lead_id
      AND e.event_type = 'stage_changed'
      AND (e.payload->>'to') = h.to_stage_id::text
  );
