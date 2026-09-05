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
}

export interface AvailablePage {
  page_id: string;
  page_name: string;
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
  settings: { notify_mode: NotifyMode; digest_chat_id: string | null; max_parallel_workers: number; paused?: boolean };
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
  external_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
  publish_accounts: { account_name: string; handle: string | null } | null;
  publish_videos: { title: string | null; file_url: string } | null;
}

export interface PublishMetrics {
  accounts_total: number;
  accounts_active: number;
  accounts_token_expired: number;
  accounts_limited_or_error: number;
  health_avg: number | null;
  jobs_queued: number;
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
  created_at: string;
  source: string;
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
  published: { label: "Опубликовано", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Ошибка", cls: "bg-destructive/10 text-destructive" },
  manual_review: { label: "Ручная проверка", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  cancelled: { label: "Отменено", cls: "bg-muted text-muted-foreground" },
};

/** Что можно сделать с заданием из интерфейса — зеркало проверок job_retry/job_cancel. */
export const JOB_ACTIONS: Record<PublishJobStatus, { retry: boolean; cancel: boolean }> = {
  pending: { retry: false, cancel: true },
  retry: { retry: true, cancel: true },
  processing: { retry: false, cancel: false },
  published: { retry: false, cancel: false },
  failed: { retry: true, cancel: false },
  manual_review: { retry: true, cancel: true },
  cancelled: { retry: true, cancel: false },
};

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

/* ───────────────────────────── API ───────────────────────────── */

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("publish-accounts", {
    body: { action, ...body },
  });
  if (error) {
    // FunctionsHttpError несёт тело ответа с человекочитаемой ошибкой.
    const ctx = (error as { context?: Response }).context;
    let message = error.message || "Ошибка запроса";
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) message = j.error;
      } catch {
        /* ignore */
      }
    }
    throw new Error(message);
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
  timezone?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  ramp_enabled?: boolean;
  ramp_restart?: true;
  notes?: string;
}

export interface GroupUpsertInput {
  id?: string;
  name: string;
  account_ids: string[];
  platform?: PublishPlatform | null;
  publish_strategy?: PublishStrategy;
  per_hour?: number;
  persona_id?: string | null;
  review_mode?: ReviewMode;
  timezone?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  min_gap_minutes?: number;
  jitter_minutes?: number;
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

export interface SettingsUpsertInput {
  notify_mode?: NotifyMode;
  digest_chat_id?: string | null;
  paused?: boolean;
  daily_usd?: number;
  monthly_usd?: number;
}

export interface PublishVideoInput {
  file_url?: string;
  video_id?: string;
  group_id?: string;
  account_ids?: string[];
  mode?: PublishMode;
  title?: string;
  caption?: string;
  hashtags?: string[];
  start_at?: string;
}

export const publishingApi = {
  list: (project_id: string) => call<{ accounts: PublishAccount[] }>("list", { project_id }),
  /** meta_token — вставленный вручную User Access Token, когда токены проекта площадка отклоняет. */
  available: (project_id: string, meta_token?: string | null) =>
    call<{ pages: AvailablePage[] }>("available", { project_id, ...(meta_token ? { meta_token } : {}) }),
  connect: (project_id: string, page_ids: string[], meta_token?: string | null, group_id?: string | null) =>
    call<{ connected: unknown[]; skipped: { page_id: string; reason: string }[] }>("connect", {
      project_id, page_ids, ...(meta_token ? { meta_token } : {}), ...(group_id ? { group_id } : {}),
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
    call<{ ok: true }>("settings_upsert", { project_id, ...input }),

  jobsList: (project_id: string, opts: { status?: PublishJobStatus; limit?: number } = {}) =>
    call<{ jobs: PublishJob[] }>("jobs_list", { project_id, ...opts }),
  metrics: (project_id: string) => call<MetricsResponse>("metrics", { project_id }),
  jobRetry: (project_id: string, job_id: string) => call<{ ok: true; status: "pending" }>("job_retry", { project_id, job_id }),
  jobCancel: (project_id: string, job_id: string) => call<{ ok: true; status: "cancelled" }>("job_cancel", { project_id, job_id }),
  publishVideo: (project_id: string, input: PublishVideoInput) =>
    call<PublishVideoResult>("publish_video", { project_id, ...input }),
};

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

/** Ссылка на согласие площадки (edge publish-oauth/start); открывать в новом окне. */
export async function startPublishOAuth(projectId: string, platform: OAuthPlatform, groupId?: string | null): Promise<string> {
  const { data, error } = await supabase.functions.invoke("publish-oauth/start", {
    body: { project_id: projectId, platform, return_url: `${window.location.origin}/marketing/publishing`, group_id: groupId ?? null },
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
