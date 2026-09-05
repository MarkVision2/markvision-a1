-- Библиотека видео и повторная публикация.
--
-- 1. Уникальность (video_id, account_id) в publish_jobs была полной: одно видео в
--    один аккаунт — навсегда. Вечнозелёный ролик нельзя было выпустить второй раз,
--    а после «Отменить» — поставить снова. Теперь уникальность частичная: не больше
--    одного АКТИВНОГО задания на пару (pending / retry / processing / manual_review);
--    опубликованные, упавшие и отменённые второму заходу не мешают.
-- 2. plan_publish_slots получает p_repost: по умолчанию (false) остаётся идемпотентным
--    для автоматических вызовов — у аккаунта уже есть задание с этим видео (кроме
--    отменённого) → возвращает его с created = false; p_repost = true ставит новое.
-- 3. Витрина publish_video_stats — задания по каждому видео для вкладки «Видео».

-- ── 1. частичная уникальность ────────────────────────────────────────────────
DO $$
DECLARE
  c text;
  a_video smallint := (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.publish_jobs'::regclass AND attname = 'video_id');
  a_acc   smallint := (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.publish_jobs'::regclass AND attname = 'account_id');
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.publish_jobs'::regclass AND contype = 'u'
       AND array_length(conkey, 1) = 2 AND conkey <@ ARRAY[a_video, a_acc]
  LOOP
    EXECUTE format('ALTER TABLE public.publish_jobs DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_active_pair_uniq
  ON public.publish_jobs (video_id, account_id)
  WHERE status IN ('pending', 'retry', 'processing', 'manual_review');

COMMENT ON INDEX public.publish_jobs_active_pair_uniq IS
  'Не больше одного активного задания «это видео → этот аккаунт»; завершённые повтору не мешают.';

-- ── 2. планировщик с p_repost ────────────────────────────────────────────────
-- Новая сигнатура: старую убираем, иначе вызов с пятью аргументами станет неоднозначным.
DROP FUNCTION IF EXISTS public.plan_publish_slots(uuid, uuid, uuid[], timestamptz, text);

CREATE OR REPLACE FUNCTION public.plan_publish_slots(
  p_video_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_account_ids uuid[] DEFAULT NULL,
  p_start timestamptz DEFAULT now(),
  p_mode text DEFAULT 'drip',
  p_repost boolean DEFAULT false
) RETURNS TABLE (job_id uuid, account_id uuid, scheduled_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v public.publish_videos%ROWTYPE;
  g public.publish_account_groups%ROWTYPE;
  acc record;
  i integer := 0;
  cursor_at timestamptz;
  slot timestamptz;
  v_job uuid;
  v_created boolean;
  step interval;
  variants jsonb;
  caption text;
BEGIN
  SELECT * INTO v FROM public.publish_videos WHERE id = p_video_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'video % not found', p_video_id; END IF;
  -- Аварийная пауза проекта: ничего не планируем (publish_project_settings.paused).
  IF EXISTS (SELECT 1 FROM public.publish_project_settings s WHERE s.project_id = v.project_id AND s.paused) THEN RETURN; END IF;
  IF p_group_id IS NOT NULL THEN
    SELECT * INTO g FROM public.publish_account_groups WHERE id = p_group_id AND project_id = v.project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'group % not found', p_group_id; END IF;
    IF g.review_mode = 'paused' THEN RETURN; END IF;
  END IF;
  step := CASE
    WHEN p_mode = 'now' THEN interval '0'
    WHEN p_mode = 'daily' THEN interval '1 day'
    ELSE make_interval(secs => 3600.0 / greatest(coalesce(g.per_hour, 10), 1))
  END;
  variants := coalesce(v.caption_variants, '[]'::jsonb);

  FOR acc IN
    SELECT a.id, a.platform
      FROM public.publish_accounts a
     WHERE a.project_id = v.project_id
       AND a.status = 'active' AND a.publish_enabled
       AND a.health_score >= 20
       AND (p_group_id IS NULL OR a.group_id = p_group_id OR a.id = ANY (coalesce(g.account_ids, '{}')))
       AND (p_account_ids IS NULL OR a.id = ANY (p_account_ids))
       AND (g.platform IS NULL OR a.platform = g.platform)
       -- Пауза группы действует и при явном списке аккаунтов: иначе задания
       -- создаются, а claim их никогда не берёт.
       AND NOT EXISTS (SELECT 1 FROM public.publish_account_groups pg WHERE pg.id = a.group_id AND pg.review_mode = 'paused')
     ORDER BY a.health_score DESC, a.created_at
  LOOP
    v_job := NULL;
    IF NOT p_repost THEN
      -- Идемпотентность для конвейера и n8n: у аккаунта уже есть задание с этим
      -- видео (кроме отменённого) — отдаём его, второе не ставим.
      SELECT j.id, j.scheduled_at INTO v_job, slot FROM public.publish_jobs j
       WHERE j.video_id = v.id AND j.account_id = acc.id AND j.status <> 'cancelled'
       ORDER BY j.created_at DESC LIMIT 1;
      IF v_job IS NOT NULL THEN
        job_id := v_job; account_id := acc.id; scheduled_at := slot; created := false;
        RETURN NEXT;
        CONTINUE;
      END IF;
    END IF;

    cursor_at := p_start + step * i;
    slot := CASE WHEN p_mode = 'now' THEN p_start ELSE public.publish_next_slot(acc.id, cursor_at, p_mode <> 'now') END;
    i := i + 1;
    IF slot IS NULL THEN CONTINUE; END IF;

    caption := CASE
      WHEN jsonb_typeof(variants) = 'array' AND jsonb_array_length(variants) > 0
        THEN variants ->> ((i - 1) % jsonb_array_length(variants))
      ELSE v.base_caption
    END;

    INSERT INTO public.publish_jobs (project_id, video_id, account_id, platform, caption, hashtags, scheduled_at, next_attempt_at)
    VALUES (v.project_id, v.id, acc.id, acc.platform, caption, coalesce(v.hashtags, '{}'), slot, slot)
    ON CONFLICT (video_id, account_id) WHERE status IN ('pending', 'retry', 'processing', 'manual_review') DO NOTHING
    RETURNING id INTO v_job;
    v_created := v_job IS NOT NULL;
    IF NOT v_created THEN
      -- Активное задание с этим видео уже стоит (повтор при незакрытом первом) — отдаём его.
      SELECT j.id, j.scheduled_at INTO v_job, slot FROM public.publish_jobs j
       WHERE j.video_id = v.id AND j.account_id = acc.id
         AND j.status IN ('pending', 'retry', 'processing', 'manual_review')
       ORDER BY j.created_at DESC LIMIT 1;
    ELSIF p_mode <> 'now' THEN
      -- «Сейчас» минует планировщик, поэтому и слот не занимает — иначе он
      -- сдвигал бы min_gap для следующих настоящих слотов.
      INSERT INTO public.publish_slots (project_id, account_id, job_id, slot_at)
      VALUES (v.project_id, acc.id, v_job, slot)
      ON CONFLICT (account_id, slot_at) DO NOTHING;
    END IF;
    job_id := v_job; account_id := acc.id; scheduled_at := slot; created := v_created;
    RETURN NEXT;
  END LOOP;

  UPDATE public.publish_videos SET status = 'queued' WHERE id = v.id AND status = 'ready';
END;
$$;

REVOKE ALL ON FUNCTION public.plan_publish_slots(uuid, uuid, uuid[], timestamptz, text, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_publish_slots(uuid, uuid, uuid[], timestamptz, text, boolean) TO service_role;

-- ── 3. витрина заданий по видео ──────────────────────────────────────────────
-- Читается edge-функцией под service role; authenticated к ней доступа не имеет
-- (publish_jobs закрыт RLS, а обычное вью её обошло бы).
CREATE OR REPLACE VIEW public.publish_video_stats AS
SELECT v.id AS video_id,
       v.project_id,
       count(j.id)                                                              AS jobs_total,
       count(j.id) FILTER (WHERE j.status IN ('pending', 'retry', 'processing'))  AS queued,
       count(j.id) FILTER (WHERE j.status = 'published')                          AS published,
       count(j.id) FILTER (WHERE j.status IN ('failed', 'manual_review'))         AS failed,
       max(j.published_at)                                                       AS last_published_at,
       min(j.scheduled_at) FILTER (WHERE j.status IN ('pending', 'retry'))        AS next_scheduled_at
  FROM public.publish_videos v
  LEFT JOIN public.publish_jobs j ON j.video_id = v.id
 GROUP BY v.id, v.project_id;

REVOKE ALL ON public.publish_video_stats FROM public, anon, authenticated;
GRANT SELECT ON public.publish_video_stats TO service_role;
