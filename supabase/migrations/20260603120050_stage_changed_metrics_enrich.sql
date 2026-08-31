-- Фаза 1.5: точные «Записано / Проведено» в Таблице показателей.
--
-- 1) Обогащаем payload stage_changed ключами стадий (to_key, to_is_diagnostic).
-- 2) Бэкфилл пропущенных событий из lead_status_history.
-- 3) Индекс для выборки stage_changed за период.
--
-- ASCII-макет шапки таблицы Metrics (2 яруса):
--
-- ┌──────────┬─────────────────────────────┬──────────────────┬─────────────────────────────────────┬──────────────────────────────────────────┐
-- │          │         РЕКЛАМА             │       CRM        │           ДИАГНОСТИКА ⓘ           │                 ДЕНЬГИ                   │
-- │   Дата   ├──────────┬──────────┬────────┼─────────┬────────┼──────────┬───────────┬────────────┼──────────┬──────────┬──────────┬───────────┤
-- │ (sticky) │ Затраты  │ Передано │  CPL   │ Получено│  Квал* │ Записано │ Проведено │  Оплачено  │ Продажи  │ Выручка  │  Касса   │ Предоплаты│
-- ├──────────┼──────────┼──────────┼────────┼─────────┼────────┼──────────┼───────────┼────────────┼──────────┼──────────┼──────────┼───────────┤
-- │ 11 Ср    │ 26 100 ₸ │    12    │2 175 ₸ │    8    │   —    │    3     │     2     │  1 / 5 000₸│    1     │ 450 000₸ │ 120 000₸ │  50 000₸  │
-- │ 10 Вт    │ 18 400 ₸ │     9    │2 044 ₸ │    6    │   —    │    2     │     1     │  0 / 0     │    0     │      0 ₸ │      0 ₸ │       —   │
-- │  …       │    …     │    …     │   …    │    …    │   —    │    …     │     …     │     …      │    …     │    …     │    …     │    …      │
-- ├──────────┼──────────┼──────────┼────────┼─────────┼────────┼──────────┼───────────┼────────────┼──────────┼──────────┼──────────┼───────────┤
-- │  Итого   │  … сумма │  … сумма │ формула│  … сумма│   —    │  … сумма │  … сумма  │  … / сумма │  … сумма │  … сумма │  … сумма │  … сумма  │
-- └──────────┴──────────┴──────────┴────────┴─────────┴────────┴──────────┴───────────┴────────────┴──────────┴──────────┴──────────┴───────────┘
-- * Квал — disabled (серый фон), тултип «скоро»; CPL в «Итого» = Затраты ÷ Передано, не сумма.

-- =============================================================================
-- 1) Триггер: stage_changed с ключами стадий в payload
-- =============================================================================
CREATE OR REPLACE FUNCTION public.on_lead_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _from_key text;
  _to_key text;
  _to_is_diag boolean;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT key, is_diagnostic
      INTO _to_key, _to_is_diag
      FROM public.pipeline_stages
     WHERE id = NEW.stage_id;

    IF OLD.stage_id IS NOT NULL THEN
      SELECT key INTO _from_key FROM public.pipeline_stages WHERE id = OLD.stage_id;
    END IF;

    INSERT INTO public.lead_status_history (lead_id, from_stage_id, to_stage_id, changed_by)
    VALUES (NEW.id, OLD.stage_id, NEW.stage_id, auth.uid());

    INSERT INTO public.events (lead_id, event_type, payload, actor_id)
    VALUES (
      NEW.id,
      'stage_changed',
      jsonb_build_object(
        'from', OLD.stage_id,
        'to', NEW.stage_id,
        'from_key', _from_key,
        'to_key', _to_key,
        'to_is_diagnostic', COALESCE(_to_is_diag, false)
      ),
      auth.uid()
    );

    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 2) Бэкфилл: история стадий → events (без дублей в ±2 мин)
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
    'source', 'lead_status_history_backfill'
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
      AND abs(extract(epoch FROM (e.created_at - h.changed_at))) < 120
  );

-- =============================================================================
-- 3) Индекс для Metrics: stage_changed за период
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_events_stage_changed_created
  ON public.events (created_at DESC)
  WHERE event_type = 'stage_changed';
