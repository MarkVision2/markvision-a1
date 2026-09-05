-- Автопостинг: закрытие дефектов по итогам аудита (docs/AUTOPOSTING-PLATFORM.md).
--
--   1. Триггер здоровья по статусу не перетирает оценку, которую формула
--      publish-monitor записывает тем же UPDATE.
--   2. Гранты authenticated на новые колонки publish_accounts: витрины
--      publish_metrics / publish_group_metrics / publish_account_metrics —
--      security_invoker и без этих грантов падали с permission denied.
--      publish_accounts_safe получает те же колонки.
--   3. project_spend / project_budget_ok / publish_account_window проверяют
--      доступ к проекту (были SECURITY DEFINER без проверки и выданы authenticated).
--   4. Бакет publish-uploads: только authenticated, лимит 50 МБ (крупные файлы
--      идут через R2). Прямая запись в publish_project_settings / project_budgets
--      — только сервисом (edge-функция сама проверяет доступ).
--   5. plan_publish_slots: пауза группы учитывается и без p_group_id (по
--      a.group_id), режим now не пишет фиктивный слот.
--   6. publish_next_slot: джиттер не выходит за окно; окно через полночь
--      (22:00–02:00) работает; VOLATILE (random()).
--   7. claim_publish_jobs: не больше остатка дневного лимита на аккаунт за один
--      забор; hashtext без переполнения; лимит 0 = «не публиковать» явно.
--   8. Слоты освобождаются при failed / cancelled.

-- ── 0. Опрос обработки медиа считается отдельно от попыток ──
-- Раньше каждый опрос «контейнер ещё обрабатывается» ел attempts, и первый же
-- настоящий временный сбой после пяти опросов уходил в failed.
ALTER TABLE public.publish_jobs ADD COLUMN IF NOT EXISTS poll_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.publish_jobs.poll_count IS
  'Сколько раз воркер опрашивал обработку медиа площадкой (processing); лимит — в publishRunner.ts.';

-- ── 1. Здоровье: формула главнее счётчика ────────────────────
CREATE OR REPLACE FUNCTION public.publish_accounts_health_on_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Оценка пришла явно (publish-monitor: формула с причинами) — счётчик молчит.
  IF NEW.health_score IS DISTINCT FROM OLD.health_score THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'token_expired' THEN NEW.health_score := greatest(0, NEW.health_score - 40);
    ELSIF NEW.status = 'limited' THEN NEW.health_score := greatest(0, NEW.health_score - 15);
    ELSIF NEW.status = 'error' THEN NEW.health_score := greatest(0, NEW.health_score - 25);
    ELSIF NEW.status = 'active' AND OLD.status <> 'active' THEN NEW.health_score := greatest(NEW.health_score, 50);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publish_accounts_health ON public.publish_accounts;
CREATE TRIGGER trg_publish_accounts_health
  BEFORE UPDATE OF status, health_score ON public.publish_accounts
  FOR EACH ROW EXECUTE FUNCTION public.publish_accounts_health_on_status();

COMMENT ON FUNCTION public.publish_accounts_health_on_status() IS
  'Штрафы здоровья по смене статуса; если health_score задан тем же UPDATE (формула publishHealth.ts) — не вмешивается.';

-- ── 2. Гранты на колонки и безопасное вью ───────────────────
GRANT SELECT (
  group_id, persona_id, timezone, window_start, window_end,
  ramp_enabled, ramp_started_at, health_score, health_reasons, last_checked_at,
  published_today, published_day, token_refreshed_at, followers, metrics_synced_at, oauth_scope
) ON public.publish_accounts TO authenticated;

CREATE OR REPLACE VIEW public.publish_accounts_safe
WITH (security_invoker = true) AS
SELECT id, project_id, platform, account_name, handle, external_account_id, fb_page_id,
       token_expires_at, status, publish_enabled, daily_limit, last_post_at,
       consecutive_errors, last_error, notes, created_at, updated_at,
       group_id, persona_id, timezone, window_start, window_end,
       ramp_enabled, ramp_started_at, health_score, health_reasons, last_checked_at,
       published_today, published_day, token_refreshed_at, followers, metrics_synced_at, oauth_scope
  FROM public.publish_accounts;

GRANT SELECT ON public.publish_accounts_safe TO authenticated;

COMMENT ON VIEW public.publish_accounts_safe IS
  'publish_accounts без шифротекста токенов — представление для интерфейса (все колонки дистрибуции и здоровья).';

COMMENT ON VIEW public.publish_account_metrics IS
  'Строка на подключённый аккаунт: посты, охват/показы по последней контрольной точке, вовлечение, подписчики, статус, здоровье с причинами.';

COMMENT ON COLUMN public.publish_accounts.daily_limit IS
  'Постов в сутки на аккаунт (1..200). 0 — не публиковать: claim_publish_jobs и планировщик такой аккаунт пропускают.';

-- ── 3. SECURITY DEFINER с проверкой доступа ─────────────────
-- Сервисные роли (pg_cron, edge под service_role, вложенные вызовы из других
-- DEFINER-функций владельца) проходят без проверки; пользователь — только к своему проекту.
CREATE OR REPLACE FUNCTION public.publishing_caller_allowed(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
      OR session_user IN ('postgres', 'supabase_admin')
      OR public.user_can_access_project(p_project_id);
$$;
REVOKE ALL ON FUNCTION public.publishing_caller_allowed(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.publishing_caller_allowed(uuid) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.project_spend(p_project_id uuid)
RETURNS TABLE (spent_today_usd numeric, spent_month_usd numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.publishing_caller_allowed(p_project_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0),
           coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0)
      FROM public.usage_ledger WHERE project_id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.project_budget_ok(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.project_budgets%ROWTYPE;
  today numeric; month numeric;
BEGIN
  IF NOT public.publishing_caller_allowed(p_project_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.project_budgets WHERE project_id = p_project_id;
  IF NOT FOUND THEN b.daily_usd := 20; b.monthly_usd := 300; END IF;
  SELECT spent_today_usd, spent_month_usd INTO today, month FROM public.project_spend(p_project_id);
  RETURN (b.daily_usd = 0 OR today < b.daily_usd) AND (b.monthly_usd = 0 OR month < b.monthly_usd);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_account_window(p_account_id uuid)
RETURNS TABLE (tz text, window_start time, window_end time, min_gap_minutes integer, jitter_minutes integer, per_hour integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
BEGIN
  SELECT a.project_id INTO v_project FROM public.publish_accounts a WHERE a.id = p_account_id;
  IF v_project IS NULL THEN RETURN; END IF;
  IF NOT public.publishing_caller_allowed(v_project) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT coalesce(a.timezone, g.timezone, 'Asia/Almaty'),
           coalesce(a.window_start, g.window_start, '09:00'::time),
           coalesce(a.window_end, g.window_end, '21:00'::time),
           coalesce(g.min_gap_minutes, 120),
           coalesce(g.jitter_minutes, 20),
           coalesce(g.per_hour, 10)
      FROM public.publish_accounts a
      LEFT JOIN public.publish_account_groups g ON g.id = a.group_id
     WHERE a.id = p_account_id;
END;
$$;

-- Разгон зависит от времени — STABLE, а не IMMUTABLE (иначе индекс/генерируемая
-- колонка заморозят его). Ступени прежние: 1/2/3 поста до 7/14/28 дня.
CREATE OR REPLACE FUNCTION public.publish_account_effective_limit(
  p_daily_limit integer,
  p_ramp_enabled boolean,
  p_ramp_started_at timestamptz,
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_daily_limit <= 0 THEN 0
    WHEN NOT coalesce(p_ramp_enabled, false) OR p_ramp_started_at IS NULL THEN p_daily_limit
    WHEN p_now < p_ramp_started_at + interval '7 days'  THEN least(p_daily_limit, 1)
    WHEN p_now < p_ramp_started_at + interval '14 days' THEN least(p_daily_limit, 2)
    WHEN p_now < p_ramp_started_at + interval '28 days' THEN least(p_daily_limit, 3)
    ELSE p_daily_limit
  END;
$$;

-- ── 4. Бакет и прямые записи в настройки ────────────────────
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'publish-uploads';
    EXECUTE 'DROP POLICY IF EXISTS "publish-uploads insert" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "publish-uploads update" ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS "publish-uploads delete" ON storage.objects';
    EXECUTE 'CREATE POLICY "publish-uploads insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''publish-uploads'')';
    EXECUTE 'CREATE POLICY "publish-uploads update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''publish-uploads'')';
    EXECUTE 'CREATE POLICY "publish-uploads delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''publish-uploads'')';
  END IF;
END $$;

-- Пауза проекта и бюджеты меняются только через publish-accounts (service_role),
-- где проверяется доступ; прямой UPDATE участником с anon-ключом закрыт.
DROP POLICY IF EXISTS publish_project_settings_write ON public.publish_project_settings;
DROP POLICY IF EXISTS project_budgets_write ON public.project_budgets;

-- ── 5–6. Планировщик слотов ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_next_slot(
  p_account_id uuid,
  p_from timestamptz,
  p_jitter boolean DEFAULT true
) RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  acc record;
  cand timestamptz;
  last_at timestamptz;
  local_ts timestamp;
  local_t time;
  day_key date;
  day_count integer;
  eff_limit integer;
  guard integer := 0;
  wrap boolean;          -- окно через полночь: [start, 24:00) ∪ [00:00, end)
  end_local timestamp;
  room integer;
BEGIN
  SELECT * INTO w FROM public.publish_account_window(p_account_id);
  IF w.tz IS NULL THEN RETURN NULL; END IF;
  SELECT daily_limit, ramp_enabled, ramp_started_at INTO acc
    FROM public.publish_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  eff_limit := public.publish_account_effective_limit(acc.daily_limit, acc.ramp_enabled, acc.ramp_started_at, p_from);
  IF eff_limit <= 0 THEN RETURN NULL; END IF;
  wrap := w.window_start >= w.window_end;   -- start = end трактуем как «весь день»

  SELECT greatest(
           (SELECT max(slot_at) FROM public.publish_slots WHERE account_id = p_account_id),
           (SELECT last_post_at FROM public.publish_accounts WHERE id = p_account_id))
    INTO last_at;

  cand := greatest(p_from, coalesce(last_at + make_interval(mins => w.min_gap_minutes), p_from));

  LOOP
    guard := guard + 1;
    IF guard > 60 THEN RETURN NULL; END IF;  -- аккаунт забит на два месяца вперёд — не планируем
    local_ts := cand AT TIME ZONE w.tz;
    local_t := local_ts::time;

    -- Окно публикаций
    IF NOT wrap THEN
      IF local_t < w.window_start THEN
        cand := (local_ts::date + w.window_start) AT TIME ZONE w.tz;
        local_ts := cand AT TIME ZONE w.tz;
      ELSIF local_t >= w.window_end THEN
        cand := ((local_ts::date + 1) + w.window_start) AT TIME ZONE w.tz;
        CONTINUE;
      END IF;
      day_key := local_ts::date;
      end_local := local_ts::date + w.window_end;
    ELSE
      IF w.window_start <> w.window_end AND local_t >= w.window_end AND local_t < w.window_start THEN
        cand := (local_ts::date + w.window_start) AT TIME ZONE w.tz;
        local_ts := cand AT TIME ZONE w.tz;
      END IF;
      -- «Сутки» ночного окна начинаются в window_start: 01:00 относится к прошлому дню.
      day_key := CASE WHEN w.window_start <> w.window_end AND local_ts::time < w.window_end THEN local_ts::date - 1 ELSE local_ts::date END;
      end_local := CASE WHEN w.window_start = w.window_end THEN local_ts::date + 1 + w.window_start
                        ELSE day_key + 1 + w.window_end END;
    END IF;

    -- Дневной лимит (слоты + уже опубликованное за этот локальный день)
    SELECT count(*) INTO day_count
      FROM public.publish_slots s
     WHERE s.account_id = p_account_id
       AND (CASE WHEN wrap AND w.window_start <> w.window_end AND (s.slot_at AT TIME ZONE w.tz)::time < w.window_end
                 THEN (s.slot_at AT TIME ZONE w.tz)::date - 1
                 ELSE (s.slot_at AT TIME ZONE w.tz)::date END) = day_key;
    day_count := day_count + coalesce((
      SELECT count(*) FROM public.publish_jobs j
       WHERE j.account_id = p_account_id AND j.status = 'published'
         AND (CASE WHEN wrap AND w.window_start <> w.window_end AND (j.published_at AT TIME ZONE w.tz)::time < w.window_end
                   THEN (j.published_at AT TIME ZONE w.tz)::date - 1
                   ELSE (j.published_at AT TIME ZONE w.tz)::date END) = day_key
         AND NOT EXISTS (SELECT 1 FROM public.publish_slots s2 WHERE s2.job_id = j.id)), 0);
    IF day_count >= eff_limit THEN
      cand := ((day_key + 1) + w.window_start) AT TIME ZONE w.tz;
      CONTINUE;
    END IF;
    EXIT;
  END LOOP;

  IF p_jitter AND w.jitter_minutes > 0 THEN
    -- Джиттер вперёд, но не дальше конца окна: слот остаётся внутри [start, end).
    room := floor(extract(epoch FROM (end_local - local_ts)) / 60)::integer - 1;
    IF room > 0 THEN
      cand := cand + make_interval(mins => floor(random() * least(w.jitter_minutes, room))::integer);
    END IF;
  END IF;
  RETURN cand;
END;
$$;

CREATE OR REPLACE FUNCTION public.plan_publish_slots(
  p_video_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_account_ids uuid[] DEFAULT NULL,
  p_start timestamptz DEFAULT now(),
  p_mode text DEFAULT 'drip'
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
    ON CONFLICT (video_id, account_id) DO NOTHING
    RETURNING id INTO v_job;
    v_created := v_job IS NOT NULL;
    IF NOT v_created THEN
      SELECT id, publish_jobs.scheduled_at INTO v_job, slot FROM public.publish_jobs
       WHERE video_id = v.id AND publish_jobs.account_id = acc.id;
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

-- ── 7. Забор заданий: остаток дневного лимита на аккаунт ────
CREATE OR REPLACE FUNCTION public.claim_publish_jobs(
  p_batch        integer  DEFAULT 5,
  p_lock_timeout interval DEFAULT interval '10 minutes',
  p_partition    integer  DEFAULT NULL,
  p_partitions   integer  DEFAULT 1
)
RETURNS SETOF public.publish_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.publish_jobs
     SET status = 'retry',
         locked_at = NULL,
         error_message = coalesce(error_message, 'воркер не завершил задание, повтор'),
         updated_at = now()
   WHERE status = 'processing'
     AND locked_at IS NOT NULL
     AND locked_at < now() - p_lock_timeout;

  RETURN QUERY
  WITH cand AS (
    SELECT c.id, c.scheduled_at,
           row_number() OVER (PARTITION BY c.account_id ORDER BY c.scheduled_at, c.id) AS rn,
           -- Сколько ещё можно сегодня: лимит с разгоном минус уже опубликованное за локальный день.
           public.publish_account_effective_limit(acc.daily_limit, acc.ramp_enabled, acc.ramp_started_at, now())
             - CASE WHEN acc.published_day IS DISTINCT FROM (now() AT TIME ZONE coalesce(acc.timezone, g.timezone, 'Asia/Almaty'))::date
                    THEN 0 ELSE acc.published_today END AS remaining
      FROM public.publish_jobs c
      JOIN public.publish_accounts acc ON acc.id = c.account_id
      LEFT JOIN public.publish_account_groups g ON g.id = acc.group_id
     WHERE c.status IN ('pending', 'retry')
       AND c.scheduled_at <= now()
       AND c.next_attempt_at <= now()
       AND acc.publish_enabled
       AND acc.status = 'active'
       AND acc.health_score >= 20
       AND acc.daily_limit > 0
       AND coalesce(g.review_mode, 'review_required') <> 'paused'
       AND NOT EXISTS (SELECT 1 FROM public.publish_project_settings s WHERE s.project_id = c.project_id AND s.paused)
       AND (p_partition IS NULL OR p_partitions <= 1
            OR mod(hashtext(acc.id::text)::bigint & 2147483647, greatest(p_partitions, 1)::bigint) = p_partition)
  )
  UPDATE public.publish_jobs j
     SET status = 'processing',
         attempts = j.attempts + 1,
         locked_at = now(),
         updated_at = now()
   WHERE j.id IN (
     SELECT pj.id
       FROM public.publish_jobs pj
      WHERE pj.id IN (SELECT cand.id FROM cand WHERE cand.rn <= cand.remaining)
        AND pj.status IN ('pending', 'retry')
      ORDER BY pj.scheduled_at
      FOR UPDATE SKIP LOCKED
      LIMIT greatest(p_batch, 1)
   )
  RETURNING j.*;
END;
$$;

COMMENT ON FUNCTION public.claim_publish_jobs(integer, interval, integer, integer) IS
  'Атомарный забор заданий: аренда, статус и здоровье аккаунта, дневной лимит с разгоном (не больше остатка на аккаунт за один забор), паузы проекта и группы, партиции по аккаунту.';

-- ── 8. Слоты освобождаются, когда задание уже не выйдет ─────
CREATE OR REPLACE FUNCTION public.publish_jobs_account_bookkeeping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  tz text;
  today date;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT coalesce(a.timezone, g.timezone, 'Asia/Almaty') INTO tz
    FROM public.publish_accounts a LEFT JOIN public.publish_account_groups g ON g.id = a.group_id
   WHERE a.id = NEW.account_id;
  today := (now() AT TIME ZONE coalesce(tz, 'Asia/Almaty'))::date;

  IF NEW.status = 'published' THEN
    UPDATE public.publish_accounts
       SET published_today = CASE WHEN published_day = today THEN published_today + 1 ELSE 1 END,
           published_day = today,
           last_post_at = coalesce(NEW.published_at, now()),
           health_score = least(100, health_score + 1)
     WHERE id = NEW.account_id;
  ELSIF NEW.status = 'failed' THEN
    UPDATE public.publish_accounts SET health_score = greatest(0, health_score - 10) WHERE id = NEW.account_id;
  ELSIF NEW.status = 'retry' AND NEW.error_code IS NOT NULL AND OLD.status = 'processing' THEN
    UPDATE public.publish_accounts SET health_score = greatest(0, health_score - 3) WHERE id = NEW.account_id;
  END IF;

  -- Слот занят только живым заданием: провал и отмена возвращают его планировщику.
  IF NEW.status IN ('failed', 'cancelled') THEN
    DELETE FROM public.publish_slots WHERE job_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
