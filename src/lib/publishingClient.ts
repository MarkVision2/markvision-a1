/**
 * Сеть публикаций (модули M3/M4 из docs/AUTOPOSTING-PLATFORM-PLAN.md).
 * Типизированный клиент edge-функции publish-accounts и словари для интерфейса.
 * Контракт ответов — supabase/functions/publish-accounts/index.ts.
 */
import { supabase } from "@/integrations/supabase/client";

/* ───────────────────────────── типы ───────────────────────────── */

export type PublishPlatform = "instagram" | "tiktok" | "youtube" | "threads";
export type PublishAccountStatus = "active" | "token_expired" | "limited" | "error" | "disabled";
export type PublishStrategy = "all_at_once" | "drip" | "daily";
export type ReviewMode = "review_required" | "auto_publish" | "paused";
export type PersonaEngine = "heygen" | "reels_faceless" | "montage";
export type NotifyMode = "digest" | "each" | "silent";
export type PublishMode = "now" | "drip" | "daily";
export type PublishJobStatus =
  | "pending"
  | "retry"
  | "processing"
  | "verifying"
  | "published"
  | "failed"
  | "manual_review"
  | "cancelled";

export interface PublishAccount {
  id: string;
  platform: PublishPlatform;
  account_name: string;
  handle: string | null;
  external_account_id: string;
  status: PublishAccountStatus;
  publish_enabled: boolean;
  daily_limit: number;
  last_post_at: string | null;
  consecutive_errors: number;
  last_error: string | null;
  token_expires_at: string | null;
  group_id: string | null;
  persona_id: string | null;
  timezone: string | null;
  window_start: string | null;
  window_end: string | null;
  ramp_enabled: boolean;
  ramp_started_at: string | null;
  /** 0..100 — формула _lib/publishHealth.ts, пересчитывается при проверке. */
  health_score: number;
  /** Из чего сложилось здоровье — подсказка у числа. */
  health_reasons?: string[];
  /** Последняя живая проверка токена у площадки. */
  last_checked_at?: string | null;
  published_today: number;
  published_day: string | null;
  token_refreshed_at: string | null;
  followers: number | null;
  /** Права OAuth площадки (TikTok без video.list не отдаёт метрики). */
  oauth_scope?: string | null;
  /** Ядро Phase 1: возможности аккаунта этим токеном, тип подключения, состояние авторизации. */
  capabilities?: Record<string, boolean> | null;
  connection_type?: "oauth" | "device" | "hybrid";
  auth_status?: PublishAuthStatus;
  routine_id?: string | null;
}

export type PublishAuthStatus = "connected" | "expiring" | "expired" | "reconnect_required";
export type PublishVerificationStatus = "pending" | "verified" | "unverified" | "skipped";

export interface AvailablePage {
  page_id: string;
  /** Meta может не отдать имя страницы. */
  page_name: string | null;
  ig_user_id: string | null;
  ig_username: string | null;
  ig_name: string | null;
  ig_avatar_url?: string | null;
  ig_followers?: number | null;
  connectable: boolean;
  already_connected: boolean;
  /** Название проекта, где этот же Instagram уже подключён; null — нигде. */
  connected_elsewhere?: string | null;
}

export interface PublishGroup {
  id: string;
  name: string;
  platform: PublishPlatform | null;
  account_ids: string[];
  publish_strategy: PublishStrategy;
  per_hour: number | null;
  persona_id: string | null;
  review_mode: ReviewMode;
  timezone: string | null;
  window_start: string | null;
  window_end: string | null;
  min_gap_minutes: number | null;
  jitter_minutes: number | null;
  auto_publish_after: number | null;
  approved_streak: number;
}

export interface Persona {
  id: string;
  name: string;
  description: string | null;
  niche: string | null;
  tone_of_voice: string | null;
  forbidden_phrases: string[];
  language: string | null;
  engine_default: PersonaEngine;
  heygen_avatar_id: string | null;
  heygen_voice_id: string | null;
  eleven_voice_id: string | null;
  reels_theme: string | null;
  caption_style: string | null;
}

export interface PublishSettings {
  settings: { notify_mode: NotifyMode; digest_chat_id: string | null; max_parallel_workers: number; paused?: boolean; features?: Record<string, boolean> };
  budget: { daily_usd: number; monthly_usd: number };
  spend: { today_usd: number; month_usd: number };
}

export interface PublishJob {
  id: string;
  video_id: string;
  account_id: string;
  platform: PublishPlatform;
  status: PublishJobStatus;
  scheduled_at: string | null;
  attempts: number;
  next_attempt_at: string | null;
  external_post_id?: string | null;
  external_post_url: string | null;
  error_code: string | null;
  /** Канонический класс ошибки (AUTH_EXPIRED, RATE_LIMIT, MEDIA_INVALID…). */
  error_class?: string | null;
  error_message: string | null;
  published_at: string | null;
  /** Верификация: пост прочитан обратно у площадки (verified) или нет. */
  verification_status?: PublishVerificationStatus;
  verified_at?: string | null;
  verify_attempts?: number;
  trace_id?: string | null;
  /** Площадка не отдаёт статистику по посту (удалён / чужой токен / нет прав) — метрики не собираем до reconnect. */
  metrics_unavailable_reason?: string | null;
  /** Аренда воркера; processing без свежей аренды — зависшее задание. */
  locked_at?: string | null;
  created_at: string;
  publish_accounts: { account_name: string; handle: string | null } | null;
  publish_videos: { title: string | null; file_url: string } | null;
}

/** Сколько заданий в каждом статусе по всей очереди проекта (не по отданной странице). */
export type JobCounts = Partial<Record<PublishJobStatus | "all", number>>;

export interface PublishMetrics {
  accounts_total: number;
  accounts_active: number;
  accounts_token_expired: number;
  accounts_limited_or_error: number;
  health_avg: number | null;
  jobs_queued: number;
  /** Задания, чей слот прошёл 15+ минут назад: очередь не разбирается. */
  jobs_overdue?: number;
  jobs_processing: number;
  published_24h: number;
  failed_24h: number;
  manual_review: number;
  next_slot_at: string | null;
  tokens_expiring_7d: number;
  reach_d3_7d: number;
  spent_month_usd: number | null;
  /** Аварийная пауза проекта (publish_project_settings.paused). */
  paused?: boolean;
}

/** Витрина publish_group_metrics — строка по группе аккаунтов («Сеть»). */
export interface GroupMetrics {
  group_id: string;
  name: string;
  platform: PublishPlatform | null;
  review_mode: ReviewMode;
  persona_id: string | null;
  accounts_total: number;
  accounts_active: number;
  accounts_token_expired: number;
  health_avg: number | null;
  jobs_queued: number;
  published_7d: number;
  failed_7d: number;
  next_slot_at: string | null;
  reach_d3_7d: number;
  items_approved: number;
}

/**
 * Витрина publish_account_metrics — строка на подключённый аккаунт
 * («Подключённые»): посты, охват, вовлечение, подписчики, статус, здоровье.
 * Охват берётся по последней снятой контрольной точке поста (d7 > d3 > d1).
 */
export interface AccountMetrics {
  account_id: string;
  platform: PublishPlatform;
  account_name: string;
  handle: string | null;
  status: PublishAccountStatus;
  publish_enabled: boolean;
  health_score: number;
  health_reasons: string[];
  last_checked_at: string | null;
  followers: number | null;
  group_id: string | null;
  last_post_at: string | null;
  token_expires_at: string | null;
  consecutive_errors: number;
  posts_total: number;
  posts_30d: number;
  jobs_queued: number;
  failed_30d: number;
  /** Постов, по которым метрики реально сняты (остальные ещё «в пути»). */
  measured_posts: number;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Реакции / охват, %. null — охвата ещё нет, ноль соврал бы. */
  er_percent: number | null;
  metrics_updated_at: string | null;
}

export interface PublishVideo {
  id: string;
  title: string | null;
  status: string;
  file_url: string;
  thumbnail_url?: string | null;
  base_caption?: string | null;
  hashtags?: string[] | null;
  duration_sec?: number | null;
  created_at: string;
  source: string;
  /** Витрина publish_video_stats — задания по этому видео. */
  jobs_total?: number;
  queued?: number;
  published?: number;
  failed?: number;
  last_published_at?: string | null;
  next_scheduled_at?: string | null;
}

export interface MetricsResponse {
  publish: PublishMetrics | null;
  radar: Record<string, unknown> | null;
  videos: PublishVideo[];
  groups?: GroupMetrics[];
  accounts?: AccountMetrics[];
}

export interface PublishVideoResult {
  video_id: string;
  created: number;
  skipped: number;
  /** Почему заданий 0: пауза проекта/группы или ни один аккаунт не годен. */
  reason?: string | null;
  jobs: { job_id: string; account_id: string; scheduled_at: string; created: boolean }[];
}

/* ───────────────────────────── словари ───────────────────────────── */

export const ACCOUNT_STATUS_META: Record<PublishAccountStatus, { label: string; cls: string }> = {
  active: { label: "Активен", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  token_expired: { label: "Токен истёк", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  limited: { label: "Ограничен", cls: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  error: { label: "Ошибка", cls: "bg-destructive/10 text-destructive" },
  disabled: { label: "Выключен", cls: "bg-muted text-muted-foreground" },
};

/** Точка-акцент площадки (фильтры, сводка, предпросмотр) — один набор на весь раздел. */
export const PLATFORM_DOT: Record<PublishPlatform, string> = {
  instagram: "bg-pink-500",
  tiktok: "bg-sky-400",
  youtube: "bg-red-500",
  threads: "bg-zinc-400",
};

export const PLATFORM_META: Record<PublishPlatform, { label: string; cls: string }> = {
  instagram: { label: "Instagram", cls: "bg-pink-500/10 text-pink-700 dark:text-pink-300" },
  tiktok: { label: "TikTok", cls: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  youtube: { label: "YouTube", cls: "bg-red-500/10 text-red-700 dark:text-red-300" },
  threads: { label: "Threads", cls: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" },
};

export const REVIEW_MODE_META: Record<ReviewMode, { label: string; cls: string }> = {
  review_required: { label: "Нужно согласование", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  auto_publish: { label: "Автопубликация", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  paused: { label: "Пауза", cls: "bg-muted text-muted-foreground" },
};

export const JOB_STATUS_META: Record<PublishJobStatus, { label: string; cls: string }> = {
  pending: { label: "В очереди", cls: "bg-muted text-muted-foreground" },
  retry: { label: "Повтор", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  processing: { label: "Публикуется", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  verifying: { label: "Проверяется", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  published: { label: "Опубликовано", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Ошибка", cls: "bg-destructive/10 text-destructive" },
  manual_review: { label: "Ручная проверка", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  cancelled: { label: "Отменено", cls: "bg-muted text-muted-foreground" },
};

/** Что можно сделать с заданием из интерфейса — зеркало проверок job_retry/job_cancel. */
/** Аренда воркера живёт 10 минут (claim_publish_jobs); дольше — задание зависло. */
export const JOB_LOCK_STALE_MS = 10 * 60_000;

/** Что можно сделать с конкретным заданием: processing без живой аренды тоже можно повторить/отменить. */
export function jobActions(job: Pick<PublishJob, "status" | "locked_at">, now: number = Date.now()): { retry: boolean; cancel: boolean; stale: boolean } {
  const stale = job.status === "processing" && (!job.locked_at || now - Date.parse(job.locked_at) > JOB_LOCK_STALE_MS);
  if (stale) return { retry: true, cancel: true, stale };
  const a = JOB_ACTIONS[job.status] ?? { retry: false, cancel: false };
  return { ...a, stale };
}

export const JOB_ACTIONS: Record<PublishJobStatus, { retry: boolean; cancel: boolean }> = {
  pending: { retry: false, cancel: true },
  retry: { retry: true, cancel: true },
  processing: { retry: false, cancel: false },
  // Площадка уже приняла пост — повтор дал бы дубль, отмена бессмысленна.
  verifying: { retry: false, cancel: false },
  published: { retry: false, cancel: false },
  failed: { retry: true, cancel: false },
  manual_review: { retry: true, cancel: true },
  cancelled: { retry: true, cancel: false },
};

/**
 * Человеческий разбор отказа задания: что случилось и что с этим делать.
 *
 * Коды приходят из публикаторов (_lib/publishers/*): у Meta и Threads это
 * числовой код графа, у TikTok/YouTube — строковый reason, плюс собственные
 * коды раннера. Оператору «190» и «container_error» не говорят ничего, поэтому
 * рядом с сырым сообщением площадки показываем причину и следующий шаг.
 */
export interface JobErrorHint {
  /** Короткая причина для строки таблицы. */
  title: string;
  /** Что сделать оператору. */
  action: string;
}

const JOB_ERROR_HINTS: { match: RegExp; hint: JobErrorHint }[] = [
  { match: /^(no_token|token_unreadable)$/, hint: { title: "Токен аккаунта не читается", action: "Переподключите аккаунт кнопкой «Подключить аккаунт» — задание уйдёт само." } },
  { match: /^(190|102|10|200|401|403|invalid_token|access_token_invalid|unauthorized|invalid_grant)$/i, hint: { title: "Площадка отвергла токен", action: "Переподключите аккаунт: токен отозван или истёк." } },
  { match: /^(4|17|32|613|429|rateLimitExceeded|quotaExceeded|spam_risk_too_many_posts|reached_active_user_cap)$/i, hint: { title: "Лимит площадки", action: "Задание повторится само позже. Если повторяется — снизьте дневной лимит аккаунта." } },
  { match: /^(no_account)$/, hint: { title: "Аккаунт удалён", action: "Задание уже не выполнить — отмените его или залейте видео заново." } },
  { match: /^(no_video)$/, hint: { title: "Видео удалено из библиотеки", action: "Залейте ролик заново и поставьте публикацию." } },
  { match: /^(processing_timeout)$/, hint: { title: "Площадка не обработала видео", action: "Обычно виноват формат или размер файла: перезалейте mp4 (H.264 + AAC) и повторите." } },
  { match: /^(container_error|container_expired)$/, hint: { title: "Площадка не собрала контейнер публикации", action: "Проверьте, что ссылка на видео открывается публично, и повторите задание." } },
  { match: /^(source_unavailable|upload_failed|no_upload_url)$/, hint: { title: "Площадка не смогла забрать файл", action: "Ссылка на видео недоступна с их стороны: проверьте, что файл отдаётся по https без авторизации." } },
  { match: /^(video_size|video_duration|duration|file_format|picture_size_check_failed)$/i, hint: { title: "Файл не подошёл площадке", action: "Проверьте длительность, вес и соотношение сторон под требования площадки и перезалейте." } },
  { match: /^(not_implemented)$/, hint: { title: "Публикация в эту площадку ещё не подключена", action: "Оставьте задание в ручном разборе или отмените его." } },
  { match: /^(publisher_exception|timeout|internal_error|server_error|2)$/i, hint: { title: "Временный сбой площадки", action: "Повторите задание — обычно проходит со второго раза." } },
];

/** Разбор кода отказа; null — код незнакомый, показываем только текст площадки. */
export function jobErrorHint(code: string | null | undefined): JobErrorHint | null {
  if (!code) return null;
  const found = JOB_ERROR_HINTS.find((h) => h.match.test(code.trim()));
  return found?.hint ?? null;
}

export const STRATEGY_META: Record<PublishStrategy, { label: string }> = {
  all_at_once: { label: "Все сразу" },
  drip: { label: "Постепенно (drip)" },
  daily: { label: "По одному в день" },
};

export const ENGINE_META: Record<PersonaEngine, { label: string }> = {
  heygen: { label: "HeyGen (аватар)" },
  reels_faceless: { label: "Reels faceless" },
  montage: { label: "Монтаж съёмки" },
};

export const NOTIFY_MODE_META: Record<NotifyMode, { label: string }> = {
  digest: { label: "Дайджест" },
  each: { label: "Каждое событие" },
  silent: { label: "Без уведомлений" },
};

export const PUBLISH_MODE_META: Record<PublishMode, { label: string }> = {
  now: { label: "Сейчас" },
  drip: { label: "Постепенно (drip)" },
  daily: { label: "По одному в день" },
};

/* ───────────────────────────── чистые хелперы ───────────────────────────── */

/** 12 345 → «12,3 тыс.», 1 234 567 → «1,2 млн» — для строк аккаунтов. */
export function formatFollowers(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} тыс.`;
  return n.toLocaleString("ru-RU");
}

export type HealthTone = "good" | "warn" | "bad";

/** Тон индикатора здоровья аккаунта: ≥70 — хорошо, ≥40 — внимание, иначе плохо. */
export function healthTone(score: number | null | undefined): HealthTone {
  const s = Number(score ?? 0);
  if (s >= 70) return "good";
  if (s >= 40) return "warn";
  return "bad";
}

export interface RampStage {
  /** 1..3 — ступени разгона, 4 — полный лимит. */
  stage: 1 | 2 | 3 | 4;
  /** Потолок публикаций в день на ступени; null — действует daily_limit. */
  limit: 1 | 2 | 3 | null;
  /** Дней до следующей ступени (0 на полном лимите). */
  daysLeft: number;
}

const DAY_MS = 86_400_000;

/**
 * Ступень разгона частоты — зеркало publish_account_effective_limit из миграции:
 * <7 дней → 1/день, <14 → 2, <28 → 3, дальше — полный daily_limit.
 */
export function rampStage(
  rampEnabled: boolean,
  rampStartedAt: string | null | undefined,
  now: Date | number = Date.now(),
): RampStage {
  const full: RampStage = { stage: 4, limit: null, daysLeft: 0 };
  if (!rampEnabled || !rampStartedAt) return full;
  const start = Date.parse(rampStartedAt);
  if (Number.isNaN(start)) return full;
  const nowMs = typeof now === "number" ? now : now.getTime();
  const days = (nowMs - start) / DAY_MS;
  const left = (threshold: number) => Math.max(0, Math.ceil(threshold - days));
  if (days < 7) return { stage: 1, limit: 1, daysLeft: left(7) };
  if (days < 14) return { stage: 2, limit: 2, daysLeft: left(14) };
  if (days < 28) return { stage: 3, limit: 3, daysLeft: left(28) };
  return full;
}

/** Действующий дневной лимит с учётом разгона. */
export function effectiveDailyLimit(account: Pick<PublishAccount, "daily_limit" | "ramp_enabled" | "ramp_started_at">, now?: Date | number): number {
  const stage = rampStage(account.ramp_enabled, account.ramp_started_at, now);
  return stage.limit == null ? account.daily_limit : Math.min(account.daily_limit, stage.limit);
}

/** Часовой пояс, по которому у аккаунта считается «сегодня», когда свой не задан. */
export const DEFAULT_TIMEZONE = "Asia/Almaty";

/** Локальная дата площадки в формате YYYY-MM-DD — тем же способом, что (now() AT TIME ZONE tz)::date в SQL. */
export function localDay(timezone: string | null | undefined, now: Date | number = Date.now()): string {
  const d = typeof now === "number" ? new Date(now) : now;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    // Пояс из базы может быть мусором — не роняем страницу из-за одной строки.
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
}

/**
 * Сколько аккаунт опубликовал именно сегодня.
 *
 * В базе счётчик живёт парой published_today + published_day и обнуляется не
 * в полночь, а при первой публикации нового дня (триггер
 * publish_jobs_account_bookkeeping). claim_publish_jobs это учитывает и берёт
 * ноль, если день сменился, а интерфейс показывал вчерашнее «3 / 3» и врал,
 * будто лимит исчерпан.
 */
export function publishedToday(
  account: Pick<PublishAccount, "published_today" | "published_day" | "timezone">,
  now: Date | number = Date.now(),
): number {
  if (!account.published_day) return 0;
  return account.published_day.slice(0, 10) === localDay(account.timezone, now) ? account.published_today : 0;
}

/* ───────────────────────────── API ───────────────────────────── */

/**
 * Отказ edge-функции вместе с телом ответа: по нему интерфейс отличает
 * «нельзя» от «нельзя без подтверждения» (video_delete → needs_force).
 */
export class PublishApiError extends Error {
  readonly payload: Record<string, unknown>;
  constructor(message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = "PublishApiError";
    this.payload = payload;
  }
}

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("publish-accounts", {
    body: { action, ...body },
  });
  if (error) {
    // FunctionsHttpError несёт тело ответа с человекочитаемой ошибкой.
    const ctx = (error as { context?: Response }).context;
    let message = error.message || "Ошибка запроса";
    let payload: Record<string, unknown> = {};
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j && typeof j === "object") payload = j as Record<string, unknown>;
        if (j?.error) message = j.error;
      } catch {
        /* ignore */
      }
    }
    throw new PublishApiError(message, payload);
  }
  const payload = data as (T & { error?: string }) | null;
  if (!payload) throw new Error("Пустой ответ");
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export interface AccountUpdateInput {
  publish_enabled?: boolean;
  daily_limit?: number;
  status?: PublishAccountStatus;
  group_id?: string | null;
  persona_id?: string | null;
  routine_id?: string | null;
  timezone?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  ramp_enabled?: boolean;
  ramp_restart?: true;
  notes?: string;
  account_name?: string;
}

/** Серверная страница аккаунтов: без limit сервер отдаёт всё (старое поведение). */
export interface AccountListOpts {
  limit?: number;
  offset?: number;
  /** Поиск по имени и handle (ilike). */
  q?: string;
  platform?: PublishPlatform;
  /** null — без группы. */
  group_id?: string | null;
  status?: PublishAccountStatus;
  publish_enabled?: boolean;
}

export interface AccountListResponse {
  accounts: PublishAccount[];
  role?: ProjectRole;
  /** Сколько аккаунтов подходит под фильтры во всём проекте (не только на странице). */
  total?: number;
  offset?: number;
  limit?: number | null;
  has_more?: boolean;
}

/** Календарь публикаций: задания по аккаунтам за период (publish-accounts action=calendar). */
export interface CalendarAccount {
  id: string;
  platform: PublishPlatform;
  account_name: string;
  handle: string | null;
  status: PublishAccountStatus;
  publish_enabled: boolean;
  daily_limit: number;
  timezone: string | null;
  window_start: string | null;
  window_end: string | null;
  group_id: string | null;
}

export interface CalendarJob {
  id: string;
  video_id: string;
  account_id: string;
  platform: PublishPlatform;
  status: PublishJobStatus;
  scheduled_at: string | null;
  published_at: string | null;
  campaign_id: string | null;
  error_class: string | null;
  verification_status?: PublishVerificationStatus | null;
  external_post_url: string | null;
  publish_videos: { title: string | null } | null;
}

export interface CalendarResponse {
  from: string;
  to: string;
  accounts: CalendarAccount[];
  jobs: CalendarJob[];
  /** Заданий больше потолка выборки — сузьте период или группу. */
  truncated: boolean;
}

export interface GroupUpsertInput {
  id?: string;
  name: string;
  account_ids: string[];
  platform?: PublishPlatform | null;
  publish_strategy?: PublishStrategy;
  persona_id?: string | null;
  review_mode?: ReviewMode;
  timezone?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  /** null — вернуть значение по умолчанию (публикация в час 10, интервал 120, джиттер 20). */
  per_hour?: number | null;
  /** Сколько одобрений подряд нужно доверенной группе, чтобы публиковать без согласования. */
  auto_publish_after?: number | null;
  min_gap_minutes?: number | null;
  jitter_minutes?: number | null;
}

export interface PersonaUpsertInput {
  id?: string;
  name: string;
  description?: string | null;
  niche?: string | null;
  tone_of_voice?: string | null;
  forbidden_phrases?: string[];
  language?: string | null;
  engine_default?: PersonaEngine;
  heygen_avatar_id?: string | null;
  heygen_voice_id?: string | null;
  eleven_voice_id?: string | null;
  reels_theme?: string | null;
  caption_style?: string | null;
}

/** settings_upsert отдаёт сохранённые строки — форма показывает то, что легло в базу. */
export interface SettingsUpsertResult {
  settings: PublishSettings["settings"] | null;
  budget: PublishSettings["budget"] | null;
}

export interface SettingsUpsertInput {
  notify_mode?: NotifyMode;
  digest_chat_id?: string | null;
  paused?: boolean;
  /** null — вернуть бюджет по умолчанию (20 / 300 $). */
  daily_usd?: number | null;
  monthly_usd?: number | null;
}

/* ───────────── API-ключи проекта (edge api, docs/PUBLIC-API.md) ───────────── */

export type ApiScope = "read" | "publish" | "manage";

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiScope[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface ApiKeyCreateInput {
  name: string;
  scopes?: ApiScope[];
  expires_days?: number;
}

export const API_SCOPE_META: Record<ApiScope, { label: string; hint: string }> = {
  read: { label: "Чтение", hint: "аккаунты, группы, настройки, статусы публикаций" },
  publish: { label: "Публикация", hint: "загрузка медиа, постановка и управление заданиями (включает чтение)" },
  manage: { label: "Управление", hint: "правка аккаунтов, групп и настроек проекта (включает чтение)" },
};

export interface PublishVideoInput {
  file_url?: string;
  video_id?: string;
  group_id?: string;
  account_ids?: string[];
  mode?: PublishMode;
  title?: string;
  caption?: string;
  hashtags?: string[];
  /** Разные подписи для разных аккаунтов — планировщик раздаёт по кругу (одинаковый текст в 100 аккаунтов площадки метят как спам). */
  caption_variants?: string[];
  start_at?: string;
  /** Повтор из библиотеки: второе задание в аккаунт, где видео уже выходило. */
  repost?: boolean;
}

export const publishingApi = {
  list: (project_id: string, opts: AccountListOpts = {}) => call<AccountListResponse>("list", { project_id, ...opts }),
  /** Одна правка на пачку аккаунтов (массовый онбординг): сервер обновляет одним UPDATE. */
  accountsBulkUpdate: (project_id: string, account_ids: string[], patch: AccountUpdateInput) =>
    call<{ updated: number; missing: number }>("accounts_bulk_update", { project_id, account_ids, patch }),
  /** Задания по аккаунтам за период (до 31 дня) — вкладка «Календарь». */
  calendar: (project_id: string, opts: { from: string; to: string; group_id?: string | null; account_ids?: string[] }) =>
    call<CalendarResponse>("calendar", { project_id, from: opts.from, to: opts.to, ...(opts.group_id ? { group_id: opts.group_id } : {}), ...(opts.account_ids?.length ? { account_ids: opts.account_ids } : {}) }),
  /** meta_token — вставленный вручную User Access Token, когда токены проекта площадка отклоняет. */
  available: (project_id: string, meta_token?: string | null) =>
    call<{ pages: AvailablePage[] }>("available", { project_id, ...(meta_token ? { meta_token } : {}) }),
  /** preset — правка (персона, рутина, пояс, окно, лимит, разгон) сразу на все подключённые аккаунты. */
  connect: (project_id: string, page_ids: string[], meta_token?: string | null, group_id?: string | null, preset?: AccountUpdateInput | null) =>
    call<{ connected: { id: string; account_name: string; handle: string | null }[]; skipped: { page_id: string; reason: string }[]; preset_error?: string }>("connect", {
      project_id, page_ids, ...(meta_token ? { meta_token } : {}), ...(group_id ? { group_id } : {}),
      ...(preset && Object.keys(preset).length ? { preset } : {}),
    }),
  connectThreads: (
    project_id: string,
    input: { threads_user_id: string; access_token: string; account_name?: string; group_id?: string },
  ) => call<{ account: Pick<PublishAccount, "id" | "account_name" | "handle"> }>("connect_threads", { project_id, ...input }),
  update: (project_id: string, account_id: string, patch: AccountUpdateInput) =>
    call<{ account: Partial<PublishAccount> }>("update", { project_id, account_id, ...patch }),
  disconnect: (project_id: string, account_id: string) => call<{ ok: true }>("disconnect", { project_id, account_id }),

  groupList: (project_id: string) => call<{ groups: PublishGroup[] }>("group_list", { project_id }),
  groupUpsert: (project_id: string, input: GroupUpsertInput) =>
    call<{ group: PublishGroup }>("group_upsert", { project_id, ...input }),
  groupDelete: (project_id: string, group_id: string) => call<{ ok: true }>("group_delete", { project_id, group_id }),

  personaList: (project_id: string) => call<{ personas: Persona[] }>("persona_list", { project_id }),
  personaUpsert: (project_id: string, input: PersonaUpsertInput) =>
    call<{ persona: Persona }>("persona_upsert", { project_id, ...input }),
  personaDelete: (project_id: string, persona_id: string) =>
    call<{ ok: true }>("persona_delete", { project_id, persona_id }),

  settingsGet: (project_id: string) => call<PublishSettings>("settings_get", { project_id }),
  settingsUpsert: (project_id: string, input: SettingsUpsertInput) =>
    call<SettingsUpsertResult>("settings_upsert", { project_id, ...input }),

  jobsList: (project_id: string, opts: { status?: PublishJobStatus; limit?: number; offset?: number; video_id?: string; account_id?: string; campaign_id?: string } = {}) =>
    call<{ jobs: PublishJob[]; counts?: JobCounts; has_more?: boolean }>("jobs_list", { project_id, ...opts }),
  metrics: (project_id: string) => call<MetricsResponse>("metrics", { project_id }),
  /** Убрать ролик из библиотеки вместе с заданиями; force — вместе с опубликованными постами. */
  videoDelete: (project_id: string, video_id: string, force = false) =>
    call<{ deleted_jobs: number }>("video_delete", { project_id, video_id, ...(force ? { force: true } : {}) }),
  /** Проверка связи: доходит ли уведомление в Telegram проекта. */
  notifyTest: (project_id: string) => call<{ chat_id: string; own_chat: boolean }>("notify_test", { project_id }),

  jobGet: (project_id: string, job_id: string) => call<JobDetail>("job_get", { project_id, job_id }),

  memberList: (project_id: string) => call<{ members: ProjectMember[]; me: { user_id: string | null; role: ProjectRole }; assignable: ProjectRole[] }>("member_list", { project_id }),
  memberRoleSet: (project_id: string, user_id: string, role: ProjectRole) => call<{ member: { user_id: string; role: string } }>("member_role_set", { project_id, user_id, role }),
  routineList: (project_id: string) =>
    call<{ routines: PublishRoutine[]; groups: { id: string; name: string; routine_id: string | null }[]; accounts: { id: string; account_name: string; routine_id: string | null }[] }>("routine_list", { project_id }),
  routineUpsert: (project_id: string, input: { routine_id?: string; name?: string; description?: string | null; steps?: RoutineStep[]; is_default?: boolean }) =>
    call<{ routine: PublishRoutine }>("routine_upsert", { project_id, ...input }),
  routineDelete: (project_id: string, routine_id: string) => call<{ ok: true }>("routine_delete", { project_id, routine_id }),
  routineAssign: (project_id: string, routine_id: string | null, target: { group_ids?: string[]; account_ids?: string[] }) =>
    call<{ groups: number; accounts: number }>("routine_assign", { project_id, routine_id, ...target }),
  tasksList: (project_id: string, opts: { status?: PublishTask["status"]; limit?: number } = {}) =>
    call<{ tasks: (PublishTask & { job_id: string | null; publish_accounts: { account_name: string } | null })[] }>("tasks_list", { project_id, ...opts }),

  campaignList: (project_id: string) => call<{ campaigns: PublishCampaign[]; metrics: CampaignMetrics[] }>("campaign_list", { project_id }),
  campaignGet: (project_id: string, campaign_id: string) =>
    call<{ campaign: PublishCampaign; metrics: CampaignMetrics | null; items: CampaignItem[]; jobs: PublishJob[] }>("campaign_get", { project_id, campaign_id }),
  campaignUpsert: (project_id: string, input: CampaignUpsertInput) => call<{ campaign: PublishCampaign }>("campaign_upsert", { project_id, ...input }),
  campaignItemsAdd: (project_id: string, campaign_id: string, video_ids: string[]) =>
    call<{ added: number; skipped: number }>("campaign_items_add", { project_id, campaign_id, video_ids }),
  campaignItemsRemove: (project_id: string, campaign_id: string, video_ids: string[]) =>
    call<{ removed: number }>("campaign_items_remove", { project_id, campaign_id, video_ids }),
  campaignStatus: (project_id: string, campaign_id: string, status: CampaignStatus) =>
    call<{ campaign: PublishCampaign; planned: { planned: number; jobs_created: number } | null }>("campaign_status", { project_id, campaign_id, status }),
  campaignPlanNow: (project_id: string, campaign_id: string) =>
    call<{ result: { planned: number; jobs_created: number; completed: boolean } }>("campaign_plan_now", { project_id, campaign_id }),

  webhookList: (project_id: string) => call<{ webhooks: PublishWebhook[] }>("webhook_list", { project_id }),
  webhookUpsert: (project_id: string, input: { webhook_id?: string; name?: string; url?: string; events?: string[]; enabled?: boolean; rotate_secret?: boolean }) =>
    call<{ webhook: PublishWebhook; secret?: string }>("webhook_upsert", { project_id, ...input }),
  webhookDelete: (project_id: string, webhook_id: string) => call<{ ok: true }>("webhook_delete", { project_id, webhook_id }),
  webhookDeliveries: (project_id: string, webhook_id: string) =>
    call<{ deliveries: WebhookDelivery[] }>("webhook_deliveries", { project_id, webhook_id }),
  notificationsList: (project_id: string, opts: { unread_only?: boolean; limit?: number } = {}) =>
    call<{ notifications: PublishNotification[]; unread: number }>("notifications_list", { project_id, ...opts }),
  notificationRead: (project_id: string, input: { notification_id?: string; all?: boolean }) =>
    call<{ ok: true }>("notification_read", { project_id, ...input }),
  jobRetry: (project_id: string, job_id: string) => call<{ ok: true; status: "pending" }>("job_retry", { project_id, job_id }),
  /** Повтор всей пачки упавших: по одному после падения площадки не накликаешь. */
  jobsRetryFailed: (project_id: string, video_id?: string | null) =>
    call<{ retried: number; skipped: number }>("jobs_retry_failed", { project_id, ...(video_id ? { video_id } : {}) }),
  jobCancel: (project_id: string, job_id: string) => call<{ ok: true; status: "cancelled" }>("job_cancel", { project_id, job_id }),
  publishVideo: (project_id: string, input: PublishVideoInput) =>
    call<PublishVideoResult>("publish_video", { project_id, ...input }),

  apiKeyList: (project_id: string) => call<{ keys: ApiKey[] }>("api_key_list", { project_id }),
  /** Ответ несёт сам ключ — единственный раз, дальше в базе только хэш. */
  apiKeyCreate: (project_id: string, input: ApiKeyCreateInput) =>
    call<{ key: string; api_key: ApiKey }>("api_key_create", { project_id, ...input }),
  apiKeyRevoke: (project_id: string, key_id: string) => call<{ ok: true }>("api_key_revoke", { project_id, key_id }),
};

/* ───────────────────────────── трасса задания и уведомления ───────────────────────────── */

export interface JobEvent {
  id: number;
  step: string;
  level: "info" | "warning" | "error";
  message: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface JobDetail {
  job: PublishJob & {
    poll_count?: number;
    container_id?: string | null;
    updated_at?: string;
    publish_accounts: { account_name: string; handle: string | null; platform?: PublishPlatform } | null;
  };
  events: JobEvent[];
  logs: { id: string; level: string; message: string; created_at: string }[];
  metrics: { checkpoint: string; captured_at: string; views: number; reach: number; likes: number; comments: number; shares: number; saves: number; followers: number | null }[];
  tasks?: PublishTask[];
}

export interface PublishNotification {
  id: string;
  kind: string;
  severity: "info" | "warning" | "error";
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Подпись верификации для интерфейса; pending на опубликованном — старые задания до миграции. */
export const VERIFICATION_META: Record<PublishVerificationStatus, { label: string; cls: string; hint: string }> = {
  pending: { label: "ждёт проверки", cls: "text-muted-foreground", hint: "Площадка приняла пост, воркер ещё не прочитал его обратно." },
  verified: { label: "подтверждено", cls: "text-emerald-600 dark:text-emerald-400", hint: "Пост найден у площадки после публикации." },
  unverified: { label: "не подтверждено", cls: "text-amber-600 dark:text-amber-400", hint: "Площадка вернула id поста, но прочитать его обратно не удалось — проверьте вручную." },
  skipped: { label: "без проверки", cls: "text-muted-foreground", hint: "Площадка не даёт прочитать пост этим токеном (нет прав) или задание старше верификации." },
};

/** Человекочитаемые шаги трассы (publish_job_events.step). */
export const TRACE_STEP_LABELS: Record<string, string> = {
  JOB_CREATED: "Задание создано",
  JOB_CLAIMED: "Воркер взял задание",
  AUTH_OK: "Токен проверен",
  AUTH_REFRESHED: "Токен обновлён",
  AUTH_FAILED: "Ошибка авторизации",
  CAPABILITY_OK: "Возможности аккаунта проверены",
  CAPABILITY_MISSING: "Аккаунт не имеет нужного права",
  MEDIA_OK: "Медиа проверено",
  UPLOAD_STARTED: "Загрузка на площадку",
  PROVIDER_PROCESSING: "Площадка обрабатывает медиа",
  MEDIA_CREATED: "Площадка приняла пост",
  VERIFY_STARTED: "Проверка публикации",
  VERIFIED: "Публикация подтверждена",
  VERIFY_PENDING: "Пост ещё не виден — проверим позже",
  VERIFY_SKIPPED: "Проверка недоступна",
  UNVERIFIED: "Публикация не подтверждена",
  SUCCESS: "Готово",
  RETRY: "Повтор",
  FAILED: "Ошибка",
  MANUAL_REVIEW: "Ручной разбор",
  CANCELLED: "Отменено",
  BUDGET_EXCEEDED: "Не успели за тик — вернули в очередь",
};

/* ───────────────────────────── кампании и вебхуки ───────────────────────────── */

export type CampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";

export interface PublishCampaign {
  id: string;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  start_date: string;
  end_date: string | null;
  timezone: string | null;
  group_id: string | null;
  account_ids: string[];
  posts_per_day: number;
  slot_times: string[];
  weekdays: number[];
  mode: "drip" | "now";
  distribution: "fanout" | "spread";
  planned_until: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CampaignMetrics {
  campaign_id: string;
  accounts_eligible: number;
  items_total: number;
  items_queued: number;
  items_planned: number;
  jobs_total: number;
  jobs_published: number;
  jobs_failed: number;
  jobs_open: number;
  next_slot_at: string | null;
  views_total: number;
  reach_total: number;
  engagements_total: number;
}

export interface CampaignItem {
  id: string;
  video_id: string;
  position: number;
  status: "queued" | "planned" | "skipped";
  planned_at: string | null;
  jobs_count: number;
  note: string | null;
  publish_videos: { title: string | null; file_url: string; thumbnail_url: string | null } | null;
}

export interface CampaignUpsertInput {
  campaign_id?: string;
  name?: string;
  objective?: string | null;
  start_date?: string;
  end_date?: string | null;
  timezone?: string | null;
  group_id?: string | null;
  account_ids?: string[];
  posts_per_day?: number;
  slot_times?: string[];
  weekdays?: number[];
  mode?: "drip" | "now";
  distribution?: "fanout" | "spread";
}

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; cls: string }> = {
  draft: { label: "Черновик", cls: "bg-muted text-muted-foreground" },
  active: { label: "Идёт", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  paused: { label: "Пауза", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  completed: { label: "Завершена", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  archived: { label: "Архив", cls: "bg-muted text-muted-foreground" },
};

/** Переходы статуса кампании (зеркало publish-accounts campaign_status). */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "completed", "archived"],
  paused: ["active", "completed", "archived"],
  completed: ["archived", "active"],
  archived: ["draft"],
};

/** Времена слотов по правилу кампании — зеркало SQL publish_campaign_slot_times. */
export function campaignSlotTimes(slotTimes: string[], postsPerDay: number): string[] {
  if (slotTimes.length) return [...slotTimes].sort();
  const n = Math.max(postsPerDay, 1);
  if (n === 1) return ["12:00"];
  return Array.from({ length: n }, (_, i) => {
    const minutes = 10 * 60 + Math.round((9 * 60 * i) / (n - 1));
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });
}

export interface PublishWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  created_at: string;
  last_delivery_at: string | null;
  last_status: number | null;
}

export interface WebhookDelivery {
  id: number;
  event: string;
  status: "pending" | "retry" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: string;
  response_status: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

export const WEBHOOK_EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: "*", label: "Все события" },
  { value: "publication.published", label: "Публикация подтверждена" },
  { value: "publication.failed", label: "Публикация не удалась" },
  { value: "publication.needs_human", label: "Нужен ручной разбор" },
  { value: "publication.unverified", label: "Публикация не подтверждена" },
  { value: "account.reconnect_required", label: "Нужен reconnect аккаунта" },
  { value: "campaign.completed", label: "Кампания завершена" },
  { value: "report.daily", label: "Ежедневный отчёт" },
];

/* ───────────────────────────── роли и рутины ───────────────────────────── */

export type ProjectRole = "owner" | "admin" | "manager" | "content_manager" | "operator" | "viewer";

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  content_manager: "Контент-менеджер",
  operator: "Оператор",
  viewer: "Наблюдатель",
};

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, operator: 1, content_manager: 2, manager: 3, admin: 4, owner: 5 };
export type PermissionLevel = "read" | "operate" | "publish" | "manage" | "admin";
const LEVEL_RANK: Record<PermissionLevel, number> = { read: 0, operate: 1, publish: 2, manage: 3, admin: 4 };

/** Зеркало _lib/rbac.ts: хватает ли роли для уровня действия (интерфейс прячет кнопки, сервер решает). */
export function roleAllows(role: ProjectRole | null | undefined, level: PermissionLevel): boolean {
  if (!role) return true; // роль ещё не известна — не прячем, сервер откажет сам
  return ROLE_RANK[role] >= LEVEL_RANK[level];
}

export interface ProjectMember {
  user_id: string;
  name: string | null;
  member_role: string;
  global_role: string | null;
  is_owner: boolean;
  since: string;
}

export type RoutineAction = "ACCOUNT_HEALTH_CHECK" | "TOKEN_CHECK" | "METRICS_SYNC";
export interface RoutineStep { action: RoutineAction; offset_minutes: number }

export interface PublishRoutine {
  id: string;
  name: string;
  description: string | null;
  steps: RoutineStep[];
  is_default: boolean;
  created_at: string;
}

export const ROUTINE_ACTION_LABELS: Record<RoutineAction, string> = {
  ACCOUNT_HEALTH_CHECK: "Проверка аккаунта",
  TOKEN_CHECK: "Проверка токена",
  METRICS_SYNC: "Снять метрики",
};

export interface PublishTask {
  id: number;
  task_type: RoutineAction;
  run_at: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  attempts: number;
  result: Record<string, unknown> | null;
  error: string | null;
  finished_at: string | null;
}

/** Разбор строки шагов «-15 health, +20 metrics» не нужен: форма собирает шаги по строкам. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  if (abs % 1440 === 0 && abs >= 1440) return `${sign}${abs / 1440} д`;
  if (abs % 60 === 0 && abs >= 60) return `${sign}${abs / 60} ч`;
  return `${sign}${abs} мин`;
}

/* ───────────────────────────── проверка здоровья ───────────────────────────── */

export interface HealthCheckResult {
  checked: number;
  token_expired: number;
  accounts: { id: string; account_name: string; platform: PublishPlatform; alive: boolean | null; health_score: number; reasons: string[] }[];
}

/**
 * Живая проверка аккаунтов у площадок (publish-monitor, mode=health):
 * токен, срок, отказы → health_score + причины. Без account_ids — весь проект.
 */
export async function runHealthCheck(projectId: string, accountIds?: string[]): Promise<HealthCheckResult> {
  const { data, error } = await supabase.functions.invoke("publish-monitor", {
    body: { mode: "health", project_id: projectId, ...(accountIds?.length ? { account_ids: accountIds } : {}) },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = error.message || "Ошибка проверки";
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) message = j.error;
      } catch { /* не JSON */ }
    }
    throw new Error(message);
  }
  const r = data as (HealthCheckResult & { error?: string }) | null;
  if (!r) throw new Error("Пустой ответ");
  if (r.error) throw new Error(r.error);
  return r;
}

/* ───────────────────────────── OAuth площадок ───────────────────────────── */

export type OAuthPlatform = "threads" | "tiktok" | "youtube";

/**
 * Ссылка на согласие площадки (edge publish-oauth/start); открывать в новом окне.
 * returnPath — куда вернуть пользователя после согласия (по умолчанию «Публикации»).
 */
export async function startPublishOAuth(projectId: string, platform: OAuthPlatform, groupId?: string | null, returnPath = "/marketing/publishing"): Promise<string> {
  const { data, error } = await supabase.functions.invoke("publish-oauth/start", {
    body: { project_id: projectId, platform, return_url: `${window.location.origin}${returnPath}`, group_id: groupId ?? null },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = error.message || "Ошибка запроса";
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string; hint?: string };
        if (j?.error) message = j.hint ? `${j.error}. ${j.hint}` : j.error;
      } catch { /* не JSON */ }
    }
    throw new Error(message);
  }
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("Площадка не вернула ссылку на согласие");
  return url;
}

/** Итог OAuth-редиректа из адресной строки: ?publish_connected=… или ?publish_error=…. */
export function readOAuthResult(search: string): { connected?: { platform: string; account: string | null }; error?: string } | null {
  const p = new URLSearchParams(search);
  const connected = p.get("publish_connected");
  const err = p.get("publish_error");
  if (connected) return { connected: { platform: connected, account: p.get("account") } };
  if (err) return { error: err };
  return null;
}
