-- Launch Funnel v2 (ТЗ): путь человека до покупки.
-- bot_activated → joined_group → confirmed → webinar → deposit → call → invoice → paid → student → graduate

COMMENT ON COLUMN public.pipeline_stages.stage_role IS
  'Semantic role: new|bot_activated|joined_group|confirmed|attended|deposit|call_scheduled|call_done|offer|paid|student|graduate|rejected|other (+ legacy whatsapp|warming|interest)';

-- Причины отказа под аналитику запусков
INSERT INTO public.loss_reasons (key, label, emoji, order_index) VALUES
  ('expensive',    'Дорого',                              '💰', 1),
  ('no_time',      'Нет времени',                         '⏰', 2),
  ('thinking',     'Пока думает',                          '🤔', 3),
  ('no_value',     'Не увидел ценности',                  '📉', 4),
  ('no_authority', 'Нет полномочий принимать решение',   '🏢', 5),
  ('competitor',   'Купил другое обучение',               '🔄', 6),
  ('no_contact',   'Не вышел на связь',                   '❌', 7),
  ('other',        'Другое',                               '❓', 8)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    emoji = EXCLUDED.emoji,
    order_index = EXCLUDED.order_index;

UPDATE public.loss_reasons
SET label = 'Передумал (legacy)'
WHERE key = 'changed_mind';

-- Обязательная причина при Отказе
CREATE OR REPLACE FUNCTION public.enforce_reject_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF NEW.stage_id IS NULL OR NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT stage_role INTO v_role
  FROM public.pipeline_stages
  WHERE id = NEW.stage_id;

  IF v_role = 'rejected' THEN
    IF NEW.reject_reason IS NULL OR btrim(NEW.reject_reason) = '' THEN
      RAISE EXCEPTION 'reject_reason required when moving to Отказ'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.rejected_at IS NULL THEN
      NEW.rejected_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_enforce_reject_reason ON public.leads;
CREATE TRIGGER trg_leads_enforce_reject_reason
  BEFORE UPDATE OF stage_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reject_reason();

-- Пересборка launch-воронок
DO $$
DECLARE
  r record;
  v_pipeline_id uuid;
  v_tmp_id uuid;
  v_new_id uuid;
  rec record;
  v_target_key text;
BEGIN
  FOR r IN
    SELECT p.id AS pipeline_id
    FROM public.pipelines p
    WHERE p.template_key = 'launch'
       OR p.project_id = 'cceb9a86-687b-4417-9b4e-d106bd8cc79c'
  LOOP
    v_pipeline_id := r.pipeline_id;

    UPDATE public.pipelines
    SET template_key = 'launch',
        updated_at = now()
    WHERE id = v_pipeline_id;

    -- Temp parking stage
    INSERT INTO public.pipeline_stages (
      pipeline_id, key, title, order_index, color, icon, is_terminal, is_diagnostic, stage_role
    ) VALUES (
      v_pipeline_id, '_tmp_launch', 'Новый лид', 0, 'primary', 'zap', false, false, 'new'
    )
    ON CONFLICT (pipeline_id, key) DO NOTHING
    RETURNING id INTO v_tmp_id;

    IF v_tmp_id IS NULL THEN
      SELECT id INTO v_tmp_id FROM public.pipeline_stages
      WHERE pipeline_id = v_pipeline_id AND key = '_tmp_launch' LIMIT 1;
    END IF;

    -- Remember lead → target key BEFORE deleting stages
    CREATE TEMP TABLE IF NOT EXISTS _launch_remap (
      lead_id uuid PRIMARY KEY,
      target_key text NOT NULL
    ) ON COMMIT DROP;
    DELETE FROM _launch_remap;

    FOR rec IN
      SELECT l.id AS lead_id, ps.key AS old_key, ps.stage_role AS old_role
      FROM public.leads l
      JOIN public.pipeline_stages ps ON ps.id = l.stage_id
      WHERE l.pipeline_id = v_pipeline_id
    LOOP
      v_target_key := CASE
        WHEN rec.old_key = 'new' OR rec.old_role = 'new' THEN 'new'
        WHEN rec.old_key IN ('whatsapp', 'bot_activated', 'no_answer')
          OR rec.old_role IN ('whatsapp', 'bot_activated') THEN 'bot_activated'
        WHEN rec.old_key IN ('warming', 'joined_group')
          OR rec.old_role IN ('warming', 'joined_group') THEN 'joined_group'
        WHEN rec.old_key = 'confirmed' OR rec.old_role = 'confirmed' THEN 'confirmed'
        WHEN rec.old_key IN ('visit', 'attended') OR rec.old_role = 'attended' THEN 'visit'
        WHEN rec.old_key = 'deposit' OR rec.old_role = 'deposit' THEN 'deposit'
        WHEN rec.old_key IN ('interest', 'scheduled', 'in_progress')
          OR rec.old_role IN ('interest', 'call_scheduled') THEN 'scheduled'
        WHEN rec.old_key = 'call_done' OR rec.old_role = 'call_done' THEN 'call_done'
        WHEN rec.old_key IN ('invoice', 'offer') OR rec.old_role = 'offer' THEN 'invoice'
        WHEN rec.old_key = 'paid' OR rec.old_role = 'paid' THEN 'paid'
        WHEN rec.old_key = 'student' OR rec.old_role = 'student' THEN 'student'
        WHEN rec.old_key = 'graduate' OR rec.old_role = 'graduate' THEN 'graduate'
        WHEN rec.old_key = 'rejected' OR rec.old_role = 'rejected' THEN 'rejected'
        ELSE 'new'
      END;

      INSERT INTO _launch_remap (lead_id, target_key)
      VALUES (rec.lead_id, v_target_key)
      ON CONFLICT (lead_id) DO UPDATE SET target_key = EXCLUDED.target_key;
    END LOOP;

    IF v_tmp_id IS NOT NULL THEN
      UPDATE public.leads
      SET stage_id = v_tmp_id
      WHERE pipeline_id = v_pipeline_id
        AND stage_id IN (
          SELECT id FROM public.pipeline_stages
          WHERE pipeline_id = v_pipeline_id AND key <> '_tmp_launch'
        );
    END IF;

    DELETE FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id AND key <> '_tmp_launch';

    INSERT INTO public.pipeline_stages (
      pipeline_id, key, title, order_index, color, icon, is_terminal, is_diagnostic, stage_role
    ) VALUES
      (v_pipeline_id, 'new',           'Новый лид',                 1,  'primary',     'zap',      false, false, 'new'),
      (v_pipeline_id, 'bot_activated', 'Личный бот активирован',    2,  'primary',     'message',  false, false, 'bot_activated'),
      (v_pipeline_id, 'joined_group',  'Вступил в группу',          3,  'warning',     'bell',     false, false, 'joined_group'),
      (v_pipeline_id, 'confirmed',     'Подтвердил участие',        4,  'warning',     'calendar', false, false, 'confirmed'),
      (v_pipeline_id, 'visit',         'Посетил вебинар',           5,  'warning',     'map',      false, false, 'attended'),
      (v_pipeline_id, 'deposit',       'Бронь 10 000 ₸',            6,  'success',     'card',     false, false, 'deposit'),
      (v_pipeline_id, 'scheduled',     'Созвон назначен',           7,  'accent',      'calendar', false, false, 'call_scheduled'),
      (v_pipeline_id, 'call_done',     'Созвон проведён',           8,  'accent',      'message',  false, false, 'call_done'),
      (v_pipeline_id, 'invoice',       'Счёт / договор отправлен',  9,  'accent',      'card',     false, false, 'offer'),
      (v_pipeline_id, 'paid',          'Полная оплата',             10, 'success',     'check',    true,  false, 'paid'),
      (v_pipeline_id, 'student',       'Студент',                   11, 'success',     'check',    true,  false, 'student'),
      (v_pipeline_id, 'graduate',      'Выпускник',                 12, 'success',     'check',    true,  false, 'graduate'),
      (v_pipeline_id, 'rejected',      'Отказ / потерян',           13, 'destructive', 'ban',      true,  false, 'rejected');

    -- Apply remap
    UPDATE public.leads l
    SET stage_id = ps.id
    FROM _launch_remap m
    JOIN public.pipeline_stages ps
      ON ps.pipeline_id = v_pipeline_id AND ps.key = m.target_key
    WHERE l.id = m.lead_id
      AND l.pipeline_id = v_pipeline_id;

    -- Any leftovers → new
    SELECT id INTO v_new_id FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id AND key = 'new' LIMIT 1;

    UPDATE public.leads
    SET stage_id = v_new_id
    WHERE pipeline_id = v_pipeline_id
      AND stage_id IN (
        SELECT id FROM public.pipeline_stages
        WHERE pipeline_id = v_pipeline_id AND key = '_tmp_launch'
      );

    DELETE FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id AND key = '_tmp_launch';
  END LOOP;
END $$;
