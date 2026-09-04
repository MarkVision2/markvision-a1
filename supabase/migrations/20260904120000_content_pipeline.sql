-- Контент-конвейер (ТЗ «MarkVision AI: система производства и согласования
-- контента», v1.0): тема из контент-плана → сценарий (OpenAI) → видео (HeyGen)
-- → нормализация (FFmpeg-worker) → согласование (MarkVision / Telegram).
--
-- Что здесь:
--   1. content_plan_items: пользовательские статусы failed / cancelled и
--      указатель на текущий технический запуск.
--   2. content_pipeline_settings — параметры проекта (аватар, голос, язык,
--      tone of voice, запреты, лимиты параллельности и бюджета).
--   3. pipeline_runs / pipeline_run_events — история КАЖДОЙ попытки с
--      техническими этапами (раньше этап жил в тексте ai_analysis).
--   4. content_assets — файлы (исходник HeyGen, нормализованный mp4) с
--      версиями; content_reviews — журнал решений.
--   5. pipeline_review_tokens — одноразовые токены кнопок Telegram;
--      pipeline_callback_nonces — защита закрытого callback от replay.
--   6. claim_next_content_job() — атомарный забор очереди
--      (FOR UPDATE SKIP LOCKED): два n8n-запуска никогда не возьмут одну тему.
--   7. requeue_stale_content_jobs() — возврат зависших запусков в очередь по
--      правилам этапа, лимит попыток → failed.
--   8. Витрина метрик и расход по бюджету.
--
-- Доступ: пользователь читает свои запуски/файлы/решения через RLS
-- (user_can_access_project); пишет ТОЛЬКО edge-функция content-pipeline под
-- service_role. Таблицы токенов/nonce без политик — их читает только сервер.

-- ── 1. content_plan_items ───────────────────────────────────
ALTER TABLE public.content_plan_items
  DROP CONSTRAINT IF EXISTS content_plan_items_status_check;
ALTER TABLE public.content_plan_items
  ADD CONSTRAINT content_plan_items_status_check CHECK (
    status IN ('idea', 'in_progress', 'ready', 'scheduled', 'published', 'error', 'failed', 'cancelled')
  );

ALTER TABLE public.content_plan_items
  ADD COLUMN IF NOT EXISTS pipeline_run_id uuid;

COMMENT ON COLUMN public.content_plan_items.pipeline_run_id IS
  'Текущий (последний) технический запуск конвейера — pipeline_runs.id.';

-- Очередь конвейера: REELS + idea. Частичный индекс по created_at — ровно то,
-- что читает claim_next_content_job().
CREATE INDEX IF NOT EXISTS content_plan_items_pipeline_queue_idx
  ON public.content_plan_items (created_at)
  WHERE content_type = 'REELS' AND status = 'idea';

-- ── 2. Настройки проекта ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.content_pipeline_settings (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  language text NOT NULL DEFAULT 'ru',
  script_words_min integer NOT NULL DEFAULT 90,
  script_words_max integer NOT NULL DEFAULT 130,
  tone_of_voice text,
  business_context text,
  forbidden_phrases text[] NOT NULL DEFAULT '{}',
  openai_model text NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_version text NOT NULL DEFAULT 'v5.0',
  heygen_avatar_id text,
  heygen_voice_id text,
  video_width integer NOT NULL DEFAULT 720,
  video_height integer NOT NULL DEFAULT 1280,
  video_timeout_minutes integer NOT NULL DEFAULT 20,
  max_attempts integer NOT NULL DEFAULT 3,
  max_parallel_videos integer NOT NULL DEFAULT 1,
  daily_budget_usd numeric NOT NULL DEFAULT 10,
  monthly_budget_usd numeric NOT NULL DEFAULT 100,
  telegram_chat_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_pipeline_settings_words_check CHECK (
    script_words_min > 0 AND script_words_max >= script_words_min
  ),
  CONSTRAINT content_pipeline_settings_limits_check CHECK (
    max_attempts BETWEEN 1 AND 10
    AND max_parallel_videos BETWEEN 1 AND 20
    AND video_timeout_minutes BETWEEN 1 AND 180
    AND daily_budget_usd >= 0 AND monthly_budget_usd >= 0
  )
);

COMMENT ON TABLE public.content_pipeline_settings IS
  'Параметры контент-конвейера по проекту: сценарий, HeyGen, лимиты попыток/параллельности/бюджета.';
COMMENT ON COLUMN public.content_pipeline_settings.telegram_chat_id IS
  'Чат согласования. NULL → чат проекта из telegram_links.';

ALTER TABLE public.content_pipeline_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_pipeline_settings_select ON public.content_pipeline_settings;
CREATE POLICY content_pipeline_settings_select
  ON public.content_pipeline_settings FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS content_pipeline_settings_insert ON public.content_pipeline_settings;
CREATE POLICY content_pipeline_settings_insert
  ON public.content_pipeline_settings FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS content_pipeline_settings_update ON public.content_pipeline_settings;
CREATE POLICY content_pipeline_settings_update
  ON public.content_pipeline_settings FOR UPDATE TO authenticated
  USING (public.user_can_access_project(project_id))
  WITH CHECK (public.user_can_access_project(project_id));

DROP TRIGGER IF EXISTS trg_content_pipeline_settings_updated ON public.content_pipeline_settings;
CREATE TRIGGER trg_content_pipeline_settings_updated
  BEFORE UPDATE ON public.content_pipeline_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 3. pipeline_runs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_plan_items(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'queued',
  provider text,
  provider_job_id text,
  provider_request_id text,
  attempt integer NOT NULL DEFAULT 1,
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  next_retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  error_message text,
  error_user text,
  error_node text,
  error_at timestamptz,
  cost_usd numeric NOT NULL DEFAULT 0,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_runs_state_check CHECK (
    state IN (
      'queued', 'claimed', 'script_generating', 'script_ready',
      'video_requested', 'video_rendering', 'video_ready', 'normalizing',
      'awaiting_review', 'approved', 'rejected', 'retry_wait', 'failed', 'cancelled'
    )
  ),
  CONSTRAINT pipeline_runs_attempt_check CHECK (attempt >= 1)
);

COMMENT ON TABLE public.pipeline_runs IS
  'История запусков контент-конвейера: одна строка = одна попытка, state = технический этап.';
COMMENT ON COLUMN public.pipeline_runs.error_message IS
  'Техническое сообщение для оператора. Без токенов/заголовков — маскируется в edge-функции.';
COMMENT ON COLUMN public.pipeline_runs.error_user IS
  'Безопасное сообщение пользователю (показывается в MarkVision).';
COMMENT ON COLUMN public.pipeline_runs.cost_usd IS
  'Сумма расхода OpenAI + HeyGen по попытке; детали — metadata.usage.';

CREATE INDEX IF NOT EXISTS pipeline_runs_item_idx
  ON public.pipeline_runs (content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_runs_project_state_idx
  ON public.pipeline_runs (project_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_runs_active_idx
  ON public.pipeline_runs (heartbeat_at)
  WHERE state NOT IN ('approved', 'rejected', 'failed', 'cancelled', 'awaiting_review');
CREATE INDEX IF NOT EXISTS pipeline_runs_retry_idx
  ON public.pipeline_runs (next_retry_at)
  WHERE state = 'retry_wait';
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_runs_idempotency_uidx
  ON public.pipeline_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- Один активный запуск на тему: страховка от двойной обработки поверх RPC.
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_runs_one_active_per_item_uidx
  ON public.pipeline_runs (content_item_id)
  WHERE state NOT IN ('approved', 'rejected', 'failed', 'cancelled');

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_runs_select ON public.pipeline_runs;
CREATE POLICY pipeline_runs_select
  ON public.pipeline_runs FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
-- INSERT/UPDATE/DELETE политик нет намеренно: пишет только service_role.

DROP TRIGGER IF EXISTS trg_pipeline_runs_updated ON public.pipeline_runs;
CREATE TRIGGER trg_pipeline_runs_updated
  BEFORE UPDATE ON public.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.content_plan_items
  DROP CONSTRAINT IF EXISTS content_plan_items_pipeline_run_fk;
ALTER TABLE public.content_plan_items
  ADD CONSTRAINT content_plan_items_pipeline_run_fk
  FOREIGN KEY (pipeline_run_id) REFERENCES public.pipeline_runs(id) ON DELETE SET NULL;

-- Журнал переходов: длительность каждого этапа считается по нему.
CREATE TABLE IF NOT EXISTS public.pipeline_run_events (
  id bigserial PRIMARY KEY,
  pipeline_run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  note jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_run_events_run_idx
  ON public.pipeline_run_events (pipeline_run_id, created_at);

ALTER TABLE public.pipeline_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_run_events_select ON public.pipeline_run_events;
CREATE POLICY pipeline_run_events_select
  ON public.pipeline_run_events FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- BEFORE: метка смены этапа; AFTER: строка журнала (FK на pipeline_runs
-- требует, чтобы строка запуска уже существовала).
CREATE OR REPLACE FUNCTION public.pipeline_runs_touch_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pipeline_runs_log_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pipeline_run_events (pipeline_run_id, project_id, from_state, to_state, note)
    VALUES (NEW.id, NEW.project_id, NULL, NEW.state, jsonb_build_object('attempt', NEW.attempt));
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.pipeline_run_events (pipeline_run_id, project_id, from_state, to_state, note)
    VALUES (
      NEW.id, NEW.project_id, OLD.state, NEW.state,
      jsonb_build_object('attempt', NEW.attempt, 'error_code', NEW.error_code, 'locked_by', NEW.locked_by)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_runs_touch_state ON public.pipeline_runs;
CREATE TRIGGER trg_pipeline_runs_touch_state
  BEFORE UPDATE ON public.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_runs_touch_state();

DROP TRIGGER IF EXISTS trg_pipeline_runs_log_state ON public.pipeline_runs;
CREATE TRIGGER trg_pipeline_runs_log_state
  AFTER INSERT OR UPDATE ON public.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_runs_log_state();

-- ── 4. content_assets / content_reviews ─────────────────────
CREATE TABLE IF NOT EXISTS public.content_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_plan_items(id) ON DELETE CASCADE,
  pipeline_run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  storage_path text NOT NULL,
  public_url text,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  duration_seconds numeric,
  video_codec text,
  audio_codec text,
  checksum_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_assets_type_check CHECK (
    asset_type IN ('provider_video', 'normalized_video', 'thumbnail', 'script')
  ),
  CONSTRAINT content_assets_version_check CHECK (version >= 1)
);

COMMENT ON TABLE public.content_assets IS
  'Файлы конвейера. Версия растёт на каждый новый рендер — старый asset никогда не перезаписывается.';

CREATE UNIQUE INDEX IF NOT EXISTS content_assets_item_type_version_uidx
  ON public.content_assets (content_item_id, asset_type, version);
CREATE INDEX IF NOT EXISTS content_assets_run_idx
  ON public.content_assets (pipeline_run_id);

ALTER TABLE public.content_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_assets_select ON public.content_assets;
CREATE POLICY content_assets_select
  ON public.content_assets FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

CREATE TABLE IF NOT EXISTS public.content_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES public.content_plan_items(id) ON DELETE CASCADE,
  pipeline_run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  decision text NOT NULL,
  comment text,
  reviewer_id uuid,
  reviewer_label text,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reviews_decision_check CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT content_reviews_source_check CHECK (source IN ('markvision', 'telegram'))
);

COMMENT ON TABLE public.content_reviews IS
  'Журнал согласований: кто, откуда и когда принял решение по попытке.';

-- Одно решение на попытку: повторное нажатие кнопки (MarkVision или Telegram)
-- упирается в unique и не меняет исход.
CREATE UNIQUE INDEX IF NOT EXISTS content_reviews_one_per_run_uidx
  ON public.content_reviews (pipeline_run_id);
CREATE INDEX IF NOT EXISTS content_reviews_item_idx
  ON public.content_reviews (content_item_id, created_at DESC);

ALTER TABLE public.content_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_reviews_select ON public.content_reviews;
CREATE POLICY content_reviews_select
  ON public.content_reviews FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

-- ── 5. Токены Telegram и nonce callback ─────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_review_tokens (
  token text PRIMARY KEY,
  pipeline_run_id uuid NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  decision text NOT NULL,
  chat_id text NOT NULL,
  message_id bigint,
  prompt_message_id bigint,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_review_tokens_decision_check CHECK (decision IN ('approved', 'rejected'))
);

COMMENT ON TABLE public.pipeline_review_tokens IS
  'Одноразовые токены кнопок согласования в Telegram. RLS без политик: читает только service_role.';
COMMENT ON COLUMN public.pipeline_review_tokens.prompt_message_id IS
  'Для reject: id сообщения «напишите причину» — ответ на него завершает отклонение.';

CREATE INDEX IF NOT EXISTS pipeline_review_tokens_run_idx
  ON public.pipeline_review_tokens (pipeline_run_id);
CREATE INDEX IF NOT EXISTS pipeline_review_tokens_prompt_idx
  ON public.pipeline_review_tokens (chat_id, prompt_message_id)
  WHERE prompt_message_id IS NOT NULL AND used_at IS NULL;

ALTER TABLE public.pipeline_review_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pipeline_callback_nonces (
  nonce text PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pipeline_callback_nonces IS
  'Replay-защита закрытого callback n8n → content-pipeline: nonce принимается один раз.';

ALTER TABLE public.pipeline_callback_nonces ENABLE ROW LEVEL SECURITY;

-- Дедуп апдейтов Telegram для бота согласования (telegram_updates в проде
-- принадлежит боту AI-монтажа; отдельная таблица — отдельный бот).
CREATE TABLE IF NOT EXISTS public.pipeline_telegram_updates (
  update_id bigint PRIMARY KEY,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_telegram_updates ENABLE ROW LEVEL SECURITY;

-- ── 6. Расход и бюджет ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.content_pipeline_spend(p_project_id uuid)
RETURNS TABLE (spent_today_usd numeric, spent_month_usd numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0),
    coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0)
  FROM public.pipeline_runs
  WHERE project_id = p_project_id;
$$;

CREATE OR REPLACE FUNCTION public.content_pipeline_budget_ok(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.content_pipeline_settings%ROWTYPE;
  today numeric;
  month numeric;
BEGIN
  SELECT * INTO s FROM public.content_pipeline_settings WHERE project_id = p_project_id;
  IF NOT FOUND THEN
    -- Настроек нет — действуют значения по умолчанию из определения таблицы.
    s.daily_budget_usd := 10;
    s.monthly_budget_usd := 100;
  END IF;
  SELECT spent_today_usd, spent_month_usd INTO today, month
    FROM public.content_pipeline_spend(p_project_id);
  RETURN (s.daily_budget_usd = 0 OR today < s.daily_budget_usd)
     AND (s.monthly_budget_usd = 0 OR month < s.monthly_budget_usd);
END;
$$;

COMMENT ON FUNCTION public.content_pipeline_budget_ok(uuid) IS
  'true, если дневной и месячный бюджет проекта не исчерпаны (0 = без лимита).';

-- ── 7. Забор очереди ────────────────────────────────────────
-- Кандидаты в порядке created_at:
--   а) run в retry_wait с наступившим next_retry_at — возобновляем ТУ ЖЕ попытку
--      (provider_job_id сохраняется: платное видео второй раз не заказывается);
--   б) тема REELS в статусе idea без активного запуска — новая попытка.
-- Ограничения: настройки проекта enabled, бюджет не исчерпан, число активных
-- видео-этапов в проекте < max_parallel_videos.
CREATE OR REPLACE FUNCTION public.claim_next_content_job(
  p_worker_id text,
  p_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  pipeline_run_id uuid,
  content_item_id uuid,
  project_id uuid,
  attempt integer,
  resumed boolean,
  provider_job_id text,
  run_metadata jsonb,
  title text,
  description text,
  prompts text,
  category text,
  hashtags text,
  project_name text,
  settings jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.pipeline_runs%ROWTYPE;
  v_item public.content_plan_items%ROWTYPE;
BEGIN
  -- Зависшие запуски сначала возвращаются в очередь — иначе тема, забытая
  -- умершим воркером, ждала бы только крона.
  PERFORM public.requeue_stale_content_jobs();

  -- а) возобновление retry_wait
  SELECT r.* INTO v_run
    FROM public.pipeline_runs r
    JOIN public.content_plan_items i ON i.id = r.content_item_id
   WHERE r.state = 'retry_wait'
     AND r.next_retry_at IS NOT NULL
     AND r.next_retry_at <= now()
     AND (p_project_id IS NULL OR r.project_id = p_project_id)
     AND coalesce((SELECT s.enabled FROM public.content_pipeline_settings s WHERE s.project_id = r.project_id), true)
     AND public.content_pipeline_budget_ok(r.project_id)
     AND public.content_pipeline_slot_free(r.project_id)
   ORDER BY r.next_retry_at
   FOR UPDATE OF r SKIP LOCKED
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.pipeline_runs
       SET state = 'claimed',
           attempt = pipeline_runs.attempt + 1,
           locked_at = now(),
           locked_by = p_worker_id,
           heartbeat_at = now(),
           next_retry_at = NULL,
           error_code = NULL,
           error_message = NULL,
           error_user = NULL,
           error_node = NULL,
           error_at = NULL
     WHERE id = v_run.id
     RETURNING * INTO v_run;

    UPDATE public.content_plan_items
       SET status = 'in_progress', pipeline_run_id = v_run.id
     WHERE id = v_run.content_item_id;

    RETURN QUERY
      SELECT v_run.id, i.id, i.project_id, v_run.attempt, true, v_run.provider_job_id, v_run.metadata,
             i.title, i.description, i.prompts, i.category, i.hashtags, p.name,
             public.content_pipeline_settings_json(i.project_id)
        FROM public.content_plan_items i
        JOIN public.projects p ON p.id = i.project_id
       WHERE i.id = v_run.content_item_id;
    RETURN;
  END IF;

  -- б) новая тема
  SELECT i.* INTO v_item
    FROM public.content_plan_items i
   WHERE i.content_type = 'REELS'
     AND i.status = 'idea'
     AND (p_project_id IS NULL OR i.project_id = p_project_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.pipeline_runs r
        WHERE r.content_item_id = i.id
          AND r.state NOT IN ('approved', 'rejected', 'failed', 'cancelled')
     )
     AND coalesce((SELECT s.enabled FROM public.content_pipeline_settings s WHERE s.project_id = i.project_id), true)
     AND public.content_pipeline_budget_ok(i.project_id)
     AND public.content_pipeline_slot_free(i.project_id)
   ORDER BY i.created_at
   FOR UPDATE OF i SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN; -- пустая очередь — не ошибка
  END IF;

  -- Новый запуск = новая серия попыток (attempt считается внутри запуска;
  -- ручной «Повторить» после failed не наследует исчерпанный счётчик).
  INSERT INTO public.pipeline_runs (
    content_item_id, project_id, state, attempt, locked_at, locked_by, heartbeat_at, started_at
  ) VALUES (
    v_item.id, v_item.project_id, 'claimed', 1, now(), p_worker_id, now(), now()
  ) RETURNING * INTO v_run;

  UPDATE public.content_plan_items
     SET status = 'in_progress', pipeline_run_id = v_run.id
   WHERE id = v_item.id;

  RETURN QUERY
    SELECT v_run.id, v_item.id, v_item.project_id, v_run.attempt, false, NULL::text, v_run.metadata,
           v_item.title, v_item.description, v_item.prompts, v_item.category, v_item.hashtags, p.name,
           public.content_pipeline_settings_json(v_item.project_id)
      FROM public.projects p
     WHERE p.id = v_item.project_id;
END;
$$;

-- Есть ли свободный слот HeyGen в проекте (видео-этапы = платный рендер идёт).
CREATE OR REPLACE FUNCTION public.content_pipeline_slot_free(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    SELECT count(*) FROM public.pipeline_runs r
     WHERE r.project_id = p_project_id
       AND r.state IN ('video_requested', 'video_rendering')
  ) < coalesce(
    (SELECT s.max_parallel_videos FROM public.content_pipeline_settings s WHERE s.project_id = p_project_id),
    1
  );
$$;

-- Настройки проекта одним jsonb (без секретов — их тут и нет).
CREATE OR REPLACE FUNCTION public.content_pipeline_settings_json(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT to_jsonb(s) - 'project_id' - 'updated_at'
       FROM public.content_pipeline_settings s
      WHERE s.project_id = p_project_id),
    jsonb_build_object(
      'enabled', true, 'language', 'ru', 'script_words_min', 90, 'script_words_max', 130,
      'tone_of_voice', NULL, 'business_context', NULL, 'forbidden_phrases', '[]'::jsonb,
      'openai_model', 'gpt-4o-mini', 'prompt_version', 'v5.0',
      'heygen_avatar_id', NULL, 'heygen_voice_id', NULL,
      'video_width', 720, 'video_height', 1280, 'video_timeout_minutes', 20,
      'max_attempts', 3, 'max_parallel_videos', 1,
      'daily_budget_usd', 10, 'monthly_budget_usd', 100, 'telegram_chat_id', NULL
    )
  );
$$;

-- ── 8. Зависшие запуски ─────────────────────────────────────
-- Правила по этапу (heartbeat старше порога):
--   claimed / script_generating / script_ready / video_ready / normalizing — 15 мин,
--     платного заказа ещё нет или результат уже есть → retry_wait сразу;
--   video_requested / video_rendering — video_timeout_minutes + 10 мин запаса,
--     provider_job_id остаётся: воркер сначала проверит существующий заказ;
--   awaiting_review / approved / rejected / failed / cancelled — не зависают.
-- Лимит попыток: attempt >= max_attempts → failed + тема failed. Уведомление
-- оператору шлёт edge-функция (metadata.operator_notified).
CREATE OR REPLACE FUNCTION public.requeue_stale_content_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  r record;
  v_max integer;
  v_timeout integer;
BEGIN
  FOR r IN
    SELECT p.id, p.state, p.attempt, p.project_id, p.content_item_id, p.heartbeat_at, p.locked_at
      FROM public.pipeline_runs p
     WHERE p.state IN ('claimed', 'script_generating', 'script_ready', 'video_requested',
                       'video_rendering', 'video_ready', 'normalizing')
       AND coalesce(p.heartbeat_at, p.locked_at, p.created_at) < now() - interval '15 minutes'
       FOR UPDATE SKIP LOCKED
  LOOP
    SELECT coalesce(s.max_attempts, 3), coalesce(s.video_timeout_minutes, 20)
      INTO v_max, v_timeout
      FROM public.content_pipeline_settings s
     WHERE s.project_id = r.project_id;
    IF v_max IS NULL THEN v_max := 3; END IF;
    IF v_timeout IS NULL THEN v_timeout := 20; END IF;

    -- Видео-этапы ждут дольше: рендер идёт на стороне провайдера.
    IF r.state IN ('video_requested', 'video_rendering')
       AND coalesce(r.heartbeat_at, r.locked_at) > now() - make_interval(mins => v_timeout + 10) THEN
      CONTINUE;
    END IF;

    IF r.attempt >= v_max THEN
      UPDATE public.pipeline_runs
         SET state = 'failed',
             finished_at = now(),
             locked_at = NULL,
             error_code = coalesce(error_code, 'stale_run'),
             error_message = coalesce(error_message, 'воркер не завершил этап ' || r.state || ', попытки исчерпаны'),
             error_user = coalesce(error_user, 'Генерация не завершилась после нескольких попыток. Нажмите «Повторить» или измените тему.'),
             error_node = coalesce(error_node, 'requeue_stale_content_jobs'),
             error_at = coalesce(error_at, now())
       WHERE id = r.id;
      UPDATE public.content_plan_items SET status = 'failed' WHERE id = r.content_item_id;
    ELSE
      UPDATE public.pipeline_runs
         SET state = 'retry_wait',
             locked_at = NULL,
             next_retry_at = now(),
             error_code = 'stale_run',
             error_message = 'воркер не завершил этап ' || r.state || ', возврат в очередь',
             error_node = 'requeue_stale_content_jobs',
             error_at = now()
       WHERE id = r.id;
      -- Тема остаётся in_progress: очередь возобновит тот же запуск.
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Nonce callback старше суток и истёкшие токены больше не нужны.
CREATE OR REPLACE FUNCTION public.content_pipeline_gc()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.pipeline_callback_nonces WHERE seen_at < now() - interval '1 day';
  DELETE FROM public.pipeline_telegram_updates WHERE seen_at < now() - interval '7 days';
  DELETE FROM public.pipeline_review_tokens
   WHERE used_at IS NOT NULL AND used_at < now() - interval '30 days';
$$;

-- Права: RPC очереди — только сервер.
REVOKE ALL ON FUNCTION public.claim_next_content_job(text, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stale_content_jobs() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_pipeline_gc() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_pipeline_settings_json(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.content_pipeline_slot_free(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.content_pipeline_budget_ok(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.content_pipeline_spend(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_content_job(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_content_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.content_pipeline_gc() TO service_role;
GRANT EXECUTE ON FUNCTION public.content_pipeline_settings_json(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.content_pipeline_slot_free(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.content_pipeline_budget_ok(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.content_pipeline_spend(uuid) TO service_role, authenticated;

COMMENT ON FUNCTION public.claim_next_content_job(text, uuid) IS
  'Атомарный забор одной темы конвейера (FOR UPDATE SKIP LOCKED). Пустая очередь → 0 строк.';
COMMENT ON FUNCTION public.requeue_stale_content_jobs() IS
  'Возврат зависших запусков в очередь по правилам этапа; лимит попыток → failed.';

-- ── 9. Витрина метрик ───────────────────────────────────────
CREATE OR REPLACE VIEW public.content_pipeline_metrics
WITH (security_invoker = true)
AS
SELECT
  p.id AS project_id,
  (SELECT count(*) FROM public.content_plan_items i
    WHERE i.project_id = p.id AND i.content_type = 'REELS' AND i.status = 'idea') AS queue_size,
  (SELECT extract(epoch FROM (now() - min(i.created_at)))::bigint FROM public.content_plan_items i
    WHERE i.project_id = p.id AND i.content_type = 'REELS' AND i.status = 'idea') AS oldest_queued_seconds,
  (SELECT count(*) FROM public.pipeline_runs r
    WHERE r.project_id = p.id
      AND r.state NOT IN ('approved', 'rejected', 'failed', 'cancelled', 'awaiting_review', 'retry_wait')) AS active_runs,
  (SELECT count(*) FROM public.pipeline_runs r
    WHERE r.project_id = p.id AND r.state = 'awaiting_review') AS awaiting_review,
  (SELECT count(*) FROM public.pipeline_runs r
    WHERE r.project_id = p.id AND r.state = 'retry_wait') AS retry_wait,
  (SELECT count(*) FROM public.pipeline_runs r
    WHERE r.project_id = p.id AND r.state IN ('approved', 'rejected', 'awaiting_review')
      AND r.created_at >= now() - interval '24 hours') AS succeeded_24h,
  (SELECT count(*) FROM public.pipeline_runs r
    WHERE r.project_id = p.id AND r.state = 'failed'
      AND r.created_at >= now() - interval '24 hours') AS failed_24h,
  (SELECT coalesce(sum(r.attempt - 1), 0) FROM public.pipeline_runs r
    WHERE r.project_id = p.id AND r.created_at >= now() - interval '24 hours') AS retries_24h,
  (SELECT spent_today_usd FROM public.content_pipeline_spend(p.id)) AS spent_today_usd,
  (SELECT spent_month_usd FROM public.content_pipeline_spend(p.id)) AS spent_month_usd,
  (SELECT coalesce(sum(a.size_bytes), 0) FROM public.content_assets a WHERE a.project_id = p.id) AS assets_bytes
FROM public.projects p;

GRANT SELECT ON public.content_pipeline_metrics TO authenticated;

COMMENT ON VIEW public.content_pipeline_metrics IS
  'Размер очереди, возраст старейшей темы, активные/ожидающие/упавшие запуски, расход и объём файлов по проекту.';

-- Длительность этапов — из журнала переходов.
CREATE OR REPLACE VIEW public.content_pipeline_stage_durations
WITH (security_invoker = true)
AS
SELECT project_id, pipeline_run_id, stage, seconds, finished_at
FROM (
  SELECT
    e.project_id,
    e.pipeline_run_id,
    e.from_state AS stage,
    extract(epoch FROM (e.created_at - lag(e.created_at) OVER (PARTITION BY e.pipeline_run_id ORDER BY e.created_at, e.id)))::numeric AS seconds,
    e.created_at AS finished_at
  FROM public.pipeline_run_events e
) t
WHERE t.stage IS NOT NULL;

GRANT SELECT ON public.content_pipeline_stage_durations TO authenticated;

-- ── 10. Кроны ───────────────────────────────────────────────
-- Каждые 10 минут: зависшие запуски → очередь, уведомления оператору об
-- окончательных ошибках, GC nonce/токенов. Идёт через edge-функцию (как
-- publish-monitor), чтобы Telegram-уведомления не жили в SQL.
SELECT cron.unschedule('content-pipeline-maintenance')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-pipeline-maintenance');

SELECT cron.schedule(
  'content-pipeline-maintenance',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/content-pipeline/maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
  $$
);
