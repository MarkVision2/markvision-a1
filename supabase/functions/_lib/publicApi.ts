/**
 * Маршруты публичного API (edge-функция `api`): разбор пути и требуемые права.
 * Чистая логика без базы — покрыта vitest.
 *
 * Внутри edge-runtime путь запроса выглядит как `/api/v1/…`; через шлюз
 * Supabase — `/functions/v1/api/v1/…`. Берём всё после сегмента `api`.
 */
import type { ApiScope } from "./apiKeys.ts";

export const API_VERSION = "v1";

export type ApiRoute =
  | { name: "me" }
  | { name: "accounts" }
  | { name: "account_update"; id: string }
  | { name: "accounts_health_check" }
  | { name: "groups" }
  | { name: "group_create" }
  | { name: "group_update"; id: string }
  | { name: "group_delete"; id: string }
  | { name: "settings_get" }
  | { name: "settings_update" }
  | { name: "jobs_list" }
  | { name: "metrics" }
  | { name: "upload_url" }
  | { name: "publications_list" }
  | { name: "publication_create" }
  | { name: "publications_distribute" }
  | { name: "publication_get"; id: string }
  | { name: "publication_jobs_create"; id: string }
  | { name: "job_cancel"; id: string }
  | { name: "job_retry"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сегменты после `api/v1`. null — путь не наш. */
export function apiSegments(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  const at = parts.lastIndexOf("api");
  if (at < 0) return null;
  const rest = parts.slice(at + 1);
  if (rest[0] !== API_VERSION) return null;
  return rest.slice(1).map(decodeURIComponent);
}

export function matchRoute(method: string, pathname: string): ApiRoute | null {
  const seg = apiSegments(pathname);
  if (!seg) return null;
  const m = method.toUpperCase();
  const [a, b, c] = seg;

  if (m === "GET" && seg.length === 1 && a === "me") return { name: "me" };
  if (m === "GET" && seg.length === 1 && a === "metrics") return { name: "metrics" };
  if (m === "GET" && seg.length === 1 && a === "jobs") return { name: "jobs_list" };
  if (m === "POST" && seg.length === 2 && a === "media" && b === "upload-url") return { name: "upload_url" };

  if (a === "accounts") {
    if (m === "GET" && seg.length === 1) return { name: "accounts" };
    if (m === "POST" && seg.length === 2 && b === "health-check") return { name: "accounts_health_check" };
    if (m === "POST" && seg.length === 2 && UUID.test(b ?? "")) return { name: "account_update", id: b };
    return null;
  }

  if (a === "groups") {
    if (seg.length === 1) {
      if (m === "GET") return { name: "groups" };
      if (m === "POST") return { name: "group_create" };
      return null;
    }
    if (m !== "POST" || !UUID.test(b ?? "")) return null;
    if (seg.length === 2) return { name: "group_update", id: b };
    if (seg.length === 3 && c === "delete") return { name: "group_delete", id: b };
    return null;
  }

  if (a === "settings" && seg.length === 1) {
    if (m === "GET") return { name: "settings_get" };
    if (m === "POST") return { name: "settings_update" };
    return null;
  }

  if (a === "publications") {
    if (seg.length === 1) {
      if (m === "GET") return { name: "publications_list" };
      if (m === "POST") return { name: "publication_create" };
      return null;
    }
    if (m === "POST" && seg.length === 2 && b === "distribute") return { name: "publications_distribute" };
    if (!UUID.test(b ?? "")) return null;
    if (m === "GET" && seg.length === 2) return { name: "publication_get", id: b };
    if (m === "POST" && seg.length === 3 && c === "jobs") return { name: "publication_jobs_create", id: b };
    return null;
  }

  if (a === "jobs" && m === "POST" && seg.length === 3 && UUID.test(b ?? "")) {
    if (c === "cancel") return { name: "job_cancel", id: b };
    if (c === "retry") return { name: "job_retry", id: b };
  }
  return null;
}

/**
 * Чтение — read; очередь и файлы — publish; аккаунты, группы и настройки
 * проекта — manage (живая проверка здоровья тоже: она ходит к площадкам).
 */
export function requiredScope(route: ApiRoute): ApiScope {
  switch (route.name) {
    case "me":
    case "accounts":
    case "groups":
    case "settings_get":
    case "jobs_list":
    case "metrics":
    case "publications_list":
    case "publication_get":
      return "read";
    case "account_update":
    case "accounts_health_check":
    case "group_create":
    case "group_update":
    case "group_delete":
    case "settings_update":
      return "manage";
    default:
      return "publish";
  }
}

/* ───────────── тело запроса на публикацию ───────────── */

export interface PublicationTarget {
  group_id?: string;
  account_ids?: string[];
  mode: "now" | "drip" | "daily";
  per_hour?: number;
  start_at?: string;
}

export interface PublicationInput {
  file_url: string;
  title: string | null;
  caption: string | null;
  caption_variants: string[];
  hashtags: string[];
  duration_sec: number | null;
  target: PublicationTarget | null;
}

const MODES = ["now", "drip", "daily"] as const;
const TARGET_KEYS = ["group_id", "account_ids", "mode", "start_at", "per_hour"] as const;

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);

/** Куда и как публиковать: группа или список аккаунтов, режим, старт, темп. */
export function parseTarget(src: Record<string, unknown>): { ok: true; target: PublicationTarget } | { ok: false; error: string } {
  const mode = String(src.mode ?? "drip");
  if (!(MODES as readonly string[]).includes(mode)) return { ok: false, error: `mode — один из: ${MODES.join(", ")}` };
  const accountIds = strList(src.account_ids);
  const groupId = src.group_id != null ? String(src.group_id) : undefined;
  if (groupId && !UUID.test(groupId)) return { ok: false, error: "group_id — uuid группы" };
  if (accountIds.some((id) => !UUID.test(id))) return { ok: false, error: "account_ids — список uuid аккаунтов" };
  let startAt: string | undefined;
  if (src.start_at != null) {
    const ts = Date.parse(String(src.start_at));
    if (!Number.isFinite(ts)) return { ok: false, error: "start_at — дата ISO 8601" };
    startAt = new Date(ts).toISOString();
  }
  let perHour: number | undefined;
  if (src.per_hour != null) {
    perHour = Number(src.per_hour);
    if (!Number.isFinite(perHour) || perHour <= 0) return { ok: false, error: "per_hour — число больше нуля" };
  }
  return {
    ok: true,
    target: {
      mode: mode as (typeof MODES)[number],
      ...(groupId ? { group_id: groupId } : {}),
      ...(accountIds.length ? { account_ids: accountIds } : {}),
      ...(startAt ? { start_at: startAt } : {}),
      ...(perHour ? { per_hour: perHour } : {}),
    },
  };
}

/* ───────────── раскладка пачки: один ролик → один аккаунт ───────────── */

export interface DistributeInput {
  videos: { id: string; topic_key?: string | null }[];
  batch_id: string | null;
  target: PublicationTarget & { per_day?: number; max_days?: number };
}

/**
 * POST /publications/distribute — пачка принятых видео раскладывается по сети:
 * каждый ролик в один аккаунт, не больше per_day на аккаунт в сутки, одна
 * тема (topic_key) — разные дни. Без group_id/account_ids — все аккаунты проекта.
 */
export function parseDistributeInput(body: unknown): { ok: true; input: DistributeInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw: unknown[] = Array.isArray(b.videos) ? b.videos : Array.isArray(b.video_ids) ? b.video_ids : [];
  const videos: DistributeInput["videos"] = [];
  for (const item of raw) {
    const v = typeof item === "string" ? { id: item } : ((item ?? {}) as { id?: unknown; topic_key?: unknown });
    const id = String(v.id ?? "").trim();
    if (!UUID.test(id)) return { ok: false, error: "videos[].id — uuid принятого видео" };
    videos.push({
      id,
      ...(v.topic_key !== undefined ? { topic_key: v.topic_key == null ? null : String(v.topic_key).trim().slice(0, 200) || null } : {}),
    });
  }
  if (!videos.length) return { ok: false, error: "videos — непустой список {id, topic_key?} (или video_ids)" };
  if (videos.length > 500) return { ok: false, error: "за один раз — не больше 500 видео" };

  const t = ((b.target ?? {}) as Record<string, unknown>);
  const parsedTarget = parseTarget({ ...t, mode: "drip" });
  if (parsedTarget.ok === false) return { ok: false, error: parsedTarget.error };
  const target: DistributeInput["target"] = { ...parsedTarget.target };
  if (t.per_day != null) {
    const perDay = Number(t.per_day);
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 20) return { ok: false, error: "target.per_day — целое число от 1 до 20" };
    target.per_day = perDay;
  }
  if (t.max_days != null) {
    const maxDays = Number(t.max_days);
    if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 90) return { ok: false, error: "target.max_days — целое число от 1 до 90" };
    target.max_days = maxDays;
  }
  return {
    ok: true,
    input: { videos, batch_id: b.batch_id != null ? String(b.batch_id).trim().slice(0, 120) || null : null, target },
  };
}

/** Проверка входа снаружи: ссылки, режима, дат. Ошибка — человекочитаемая. */
export function parsePublicationInput(body: unknown): { ok: true; input: PublicationInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const fileUrl = String(b.file_url ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(fileUrl)) return { ok: false, error: "file_url — https-ссылка на видео (mp4/mov)" };

  const hashtags = strList(b.hashtags).map((h) => (h.startsWith("#") ? h.slice(1) : h));

  let duration: number | null = null;
  if (b.duration_sec != null) {
    duration = Number(b.duration_sec);
    if (!Number.isFinite(duration) || duration <= 0) return { ok: false, error: "duration_sec — число секунд больше нуля" };
  }

  let target: PublicationTarget | null = null;
  const t = b.target as Record<string, unknown> | undefined;
  const wantsTarget = t != null || TARGET_KEYS.some((k) => b[k] != null);
  if (wantsTarget) {
    const parsedTarget = parseTarget(t ?? b);
    if (parsedTarget.ok === false) return { ok: false, error: parsedTarget.error };
    target = parsedTarget.target;
  }

  return {
    ok: true,
    input: {
      file_url: fileUrl,
      title: b.title != null ? String(b.title).slice(0, 200) : null,
      caption: b.caption != null ? String(b.caption) : null,
      caption_variants: strList(b.caption_variants),
      hashtags,
      duration_sec: duration,
      target,
    },
  };
}
