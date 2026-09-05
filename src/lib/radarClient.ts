/**
 * Радар идей (docs/AUTOPOSTING-PLATFORM-PLAN.md, M1): клиент edge-функции
 * `radar` и словари для интерфейса. Контракт ответов —
 * supabase/functions/radar/index.ts.
 */
import { supabase } from "@/integrations/supabase/client";

export type RadarSourceKind = "competitor_account" | "hashtag" | "ad_library_query" | "own_account";
export type RadarPlatform = "instagram" | "tiktok" | "youtube" | "threads" | "facebook";
export type RadarAnalysisStatus = "pending" | "analyzing" | "done" | "failed" | "skipped";
export type IdeaStatus = "new" | "approved" | "used" | "rejected";

export interface RadarSource {
  id: string;
  project_id: string;
  kind: RadarSourceKind;
  platform: RadarPlatform;
  handle: string;
  label: string | null;
  enabled: boolean;
  crawl_interval_hours: number;
  last_crawled_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface RadarPostMetrics {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
}

export interface RadarAnalysis {
  hook: string;
  niche: string;
  structure: { problem: string; solution: string; cta: string };
  triggers: string[];
  why_it_works: string;
  score: number;
  idea_title: string;
  idea_angle: string;
  script_outline: string;
}

export interface RadarPost {
  id: string;
  source_id: string | null;
  platform: RadarPlatform;
  external_id: string;
  url: string | null;
  author_handle: string | null;
  published_at: string | null;
  media_type: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  metrics: Partial<RadarPostMetrics> | null;
  followers: number | null;
  engagement_rate: number | null;
  velocity: number | null;
  score: number | null;
  analysis: RadarAnalysis | null;
  analysis_status: RadarAnalysisStatus;
  analyzed_at: string | null;
  error: string | null;
  /** Медиана просмотров / лайков по другим постам автора («обычно»). */
  baseline_views: number | null;
  baseline_likes: number | null;
  /** Ожидаемые просмотры для аудитории автора. */
  norm_views: number | null;
  /** Во сколько раз пост обошёл «обычно» автора (или норму). */
  x_factor: number | null;
  /** Транскрипт речи (если видео расшифровано) — только в разборе поста. */
  transcript?: string | null;
}

export interface Idea {
  id: string;
  title: string;
  hook: string | null;
  angle: string | null;
  niche: string | null;
  script_draft: string | null;
  structure: Record<string, unknown> | null;
  source_post_ids: string[];
  score: number;
  status: IdeaStatus;
  target_group_id: string | null;
  content_item_id: string | null;
  outcome_score: number | null;
  created_at: string;
}

export type RadarRunStatus = "running" | "done" | "failed";

export interface RadarRun {
  id: string;
  source_id: string | null;
  provider: string;
  /** running — актор Apify ещё работает; done — посты загружены; failed — ошибка. */
  status: RadarRunStatus;
  /** crawl — сбор источника; url — разбор одной ссылки. */
  mode: "crawl" | "url";
  url: string | null;
  actor: string | null;
  items: number;
  inserted: number;
  cost_usd: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** Что настроено на сервере: прямой сборщик Apify, запасной n8n, AI-разбор. */
export interface RadarCrawlerInfo {
  direct: boolean;
  n8n: boolean;
  ai: boolean;
}

export interface RadarMetrics {
  sources: number;
  posts_total: number;
  posts_7d: number;
  posts_unanalyzed: number;
  /** Постов с X-фактором ≥ 2. */
  posts_viral: number;
  ideas_new: number;
  ideas_used: number;
  spent_month_usd: number;
  last_run_at: string | null;
}

export interface RadarGroup {
  id: string;
  name: string;
  persona_id: string | null;
  review_mode: string | null;
}

export interface RadarOverview {
  sources: RadarSource[];
  metrics: RadarMetrics | null;
  ideas: Idea[];
  posts: RadarPost[];
  groups: RadarGroup[];
  runs: RadarRun[];
  crawler?: RadarCrawlerInfo | null;
}

export interface UpsertSourceInput {
  project_id: string;
  kind: RadarSourceKind;
  platform: RadarPlatform;
  handle: string;
  label?: string | null;
  crawl_interval_hours?: number;
  enabled?: boolean;
  id?: string;
  crawl_now?: boolean;
}

export interface IdeaPatch {
  status?: Exclude<IdeaStatus, "used">;
  title?: string;
  hook?: string;
  angle?: string;
  niche?: string;
  script_draft?: string;
  target_group_id?: string | null;
}

export interface PromoteInput {
  group_id?: string;
  persona_id?: string;
  engine?: "heygen" | "reels_faceless" | "montage";
}

/* ───────────────────────────── словари ───────────────────────────── */

// Палитра чипов: приложение тёмное, поэтому светлые оттенки (300–400) на полупрозрачной подложке.
export const SOURCE_KIND_META: Record<RadarSourceKind, { label: string; cls: string }> = {
  competitor_account: { label: "Конкурент", cls: "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30" },
  hashtag: { label: "Хештег", cls: "bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/30" },
  ad_library_query: { label: "Библиотека рекламы", cls: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30" },
  own_account: { label: "Свой аккаунт", cls: "bg-success/15 text-success ring-1 ring-inset ring-success/30" },
};

export const PLATFORM_META: Record<RadarPlatform, { label: string; short: string; cls: string }> = {
  instagram: { label: "Instagram", short: "IG", cls: "bg-pink-500/15 text-pink-300 ring-1 ring-inset ring-pink-500/30" },
  tiktok: { label: "TikTok", short: "TT", cls: "bg-slate-400/15 text-slate-200 ring-1 ring-inset ring-slate-400/30" },
  youtube: { label: "YouTube", short: "YT", cls: "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30" },
  threads: { label: "Threads", short: "TH", cls: "bg-zinc-400/15 text-zinc-200 ring-1 ring-inset ring-zinc-400/30" },
  facebook: { label: "Facebook", short: "FB", cls: "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/30" },
};

export const ANALYSIS_STATUS_META: Record<RadarAnalysisStatus, { label: string; cls: string }> = {
  pending: { label: "В очереди", cls: "bg-muted text-muted-foreground" },
  analyzing: { label: "Разбираем", cls: "bg-warning/15 text-warning" },
  done: { label: "Разобран", cls: "bg-success/15 text-success" },
  failed: { label: "Ошибка", cls: "bg-destructive/15 text-destructive" },
  skipped: { label: "Пропущен", cls: "bg-muted text-muted-foreground" },
};

export const RUN_STATUS_META: Record<RadarRunStatus, { label: string; cls: string }> = {
  running: { label: "Собираем", cls: "bg-warning/15 text-warning" },
  done: { label: "Готово", cls: "bg-success/15 text-success" },
  failed: { label: "Ошибка", cls: "bg-destructive/15 text-destructive" },
};

export const IDEA_STATUS_META: Record<IdeaStatus, { label: string; cls: string }> = {
  new: { label: "Новая", cls: "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30" },
  approved: { label: "Одобрена", cls: "bg-success/15 text-success ring-1 ring-inset ring-success/30" },
  used: { label: "В плане", cls: "bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/30" },
  rejected: { label: "Отклонена", cls: "bg-muted text-muted-foreground" },
};

export type ScoreTone = "hot" | "warm" | "cold";

export const SCORE_TONE_CLS: Record<ScoreTone, string> = {
  hot: "bg-success/20 text-success ring-1 ring-inset ring-success/40",
  warm: "bg-warning/20 text-warning ring-1 ring-inset ring-warning/40",
  cold: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
};

/* ───────────────────────────── чистые помощники ───────────────────────────── */

/** ER хранится долей (interactions / followers): 0.06 → «6,0 %». */
export function formatEngagement(er: number | null | undefined): string {
  if (er == null || !Number.isFinite(er)) return "—";
  return `${(er * 100).toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Тон бейджа оценки: ≥75 — горячо, ≥55 — тепло, иначе холодно. */
export function scoreTone(score: number | null | undefined): ScoreTone {
  const n = Number(score ?? 0);
  if (n >= 75) return "hot";
  if (n >= 55) return "warm";
  return "cold";
}

/** «@handle», ссылка на профиль Instagram/TikTok/Threads или голый ник → ник. */
export function sourceHandleFromUrl(input: string): string {
  let s = input.trim();
  if (!s) return "";
  const m = s.match(/^https?:\/\/(?:www\.|m\.)?(?:instagram\.com|tiktok\.com|threads\.(?:net|com))\/([^/?#]+)/i);
  if (m) s = m[1];
  return s.replace(/^@+/, "").replace(/\/+$/, "").trim();
}

/* ───────────────────────────── клиент ───────────────────────────── */

async function call<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(path, {
    method,
    ...(body ? { body } : {}),
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

export const radarApi = {
  overview: (projectId: string) =>
    call<RadarOverview>(`radar?project_id=${encodeURIComponent(projectId)}`, "GET"),
  upsertSource: (input: UpsertSourceInput) =>
    call<{ source: RadarSource; kicked: boolean; kick_error?: string | null; run_id?: string | null }>("radar/sources", "POST", { ...input }),
  deleteSource: (id: string) => call<{ ok: true }>(`radar/sources/${id}/delete`, "POST", {}),
  crawlSource: (id: string) => call<{ kicked: boolean; run_id?: string | null }>(`radar/sources/${id}/crawl`, "POST", {}),
  analyzeUrl: (projectId: string, url: string) =>
    call<{ kicked: boolean; run_id?: string | null; message: string }>("radar/analyze-url", "POST", { project_id: projectId, url }),
  post: (id: string) =>
    call<{ post: RadarPost & { video_url: string | null; transcript: string | null }; ideas: Pick<Idea, "id" | "title" | "status" | "content_item_id" | "score">[] }>(`radar/posts/${id}`, "GET"),
  analyzePost: (id: string) =>
    call<{ ok: boolean; idea_id: string | null; error: string | null }>(`radar/posts/${id}/analyze`, "POST", {}),
  updateIdea: (id: string, patch: IdeaPatch) => call<{ idea: Idea }>(`radar/ideas/${id}`, "POST", { ...patch }),
  promoteIdea: (id: string, input: PromoteInput = {}) =>
    call<{ item_id: string }>(`radar/ideas/${id}/promote`, "POST", { ...input }),
};
