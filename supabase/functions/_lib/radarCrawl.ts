/**
 * Радар идей: прямой сборщик через Apify (без n8n). Чистая логика — какой
 * актор и с каким входом запускать для источника или одной ссылки, как
 * развернуть ответ актора в элементы для ingest, сколько это стоило.
 * Без сети и БД — покрыто тестами src/test/radarCrawl.test.ts.
 */
import { RADAR_PLATFORMS, type RadarPlatform } from "./radar.ts";

export type Json = Record<string, unknown>;

export interface ApifyRunSpec {
  /** Актор в формате `user~name` (так его принимает REST API). */
  actor: string;
  input: Json;
  platform: RadarPlatform;
}

export interface CrawlSourceSpec {
  kind: string;
  platform: string;
  handle: string;
  limit?: number;
}

/** Сколько постов брать за один сбор источника. */
export const CRAWL_RESULTS_LIMIT = 12;

/** Таймаут запуска актора (секунды) — дольше ждать нет смысла. */
export const APIFY_RUN_TIMEOUT_SEC = 300;

/** Запуск, не завершившийся за это время, считаем зависшим. */
export const APIFY_RUN_STALE_MS = 20 * 60_000;

export const APIFY_ACTORS = {
  instagram: "apify~instagram-scraper",
  tiktok: "clockworks~tiktok-scraper",
  youtube: "streamers~youtube-scraper",
} as const;

/** Цена за результат (USD, тариф FREE — верхняя оценка) + старт TikTok-актора. */
const APIFY_PRICE_PER_RESULT: Record<string, number> = {
  [APIFY_ACTORS.instagram]: 0.0027,
  [APIFY_ACTORS.tiktok]: 0.0037,
  [APIFY_ACTORS.youtube]: 0.004,
};
const APIFY_START_FEE: Record<string, number> = { [APIFY_ACTORS.tiktok]: 0.001 };

const clampLimit = (n: number | undefined) => Math.min(Math.max(Math.round(n ?? CRAWL_RESULTS_LIMIT), 1), 50);
const cleanHandle = (h: string) => h.trim().replace(/^[@#]+/, "").replace(/\/+$/, "");

/** Площадка по ссылке на публикацию; null — не распознана. */
export function detectUrlPlatform(url: string): RadarPlatform | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, "");
  } catch {
    return null;
  }
  if (host === "instagram.com") return "instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "threads.net" || host === "threads.com") return "threads";
  if (host === "facebook.com" || host === "fb.watch" || host.endsWith(".facebook.com")) return "facebook";
  return null;
}

/** Человекочитаемая причина, почему сбор невозможен, либо null. */
export function crawlUnsupportedReason(spec: CrawlSourceSpec): string | null {
  if (!(RADAR_PLATFORMS as readonly string[]).includes(spec.platform)) return "неизвестная площадка";
  if (spec.kind === "ad_library_query") return "библиотека рекламы пока не собирается автоматически";
  if (spec.platform === "threads" || spec.platform === "facebook") {
    return `сбор ${spec.platform === "threads" ? "Threads" : "Facebook"} пока не поддерживается`;
  }
  if (spec.kind === "hashtag" && spec.platform === "youtube") return "хештеги YouTube не поддерживаются";
  if (!cleanHandle(spec.handle)) return "пустой ник";
  return null;
}

/**
 * Источник → запуск актора. Instagram-аккаунт берём как `details`: профиль с
 * подписчиками и последними постами одним запуском (подписчики нужны для ER).
 */
export function buildSourceRun(spec: CrawlSourceSpec): ApifyRunSpec | null {
  if (crawlUnsupportedReason(spec)) return null;
  const handle = cleanHandle(spec.handle);
  const limit = clampLimit(spec.limit);
  const platform = spec.platform as RadarPlatform;
  if (platform === "instagram") {
    if (spec.kind === "hashtag") {
      return {
        actor: APIFY_ACTORS.instagram,
        platform,
        input: { directUrls: [`https://www.instagram.com/explore/tags/${handle}/`], resultsType: "posts", resultsLimit: limit },
      };
    }
    return {
      actor: APIFY_ACTORS.instagram,
      platform,
      input: { directUrls: [`https://www.instagram.com/${handle}/`], resultsType: "details", resultsLimit: limit },
    };
  }
  if (platform === "tiktok") {
    return {
      actor: APIFY_ACTORS.tiktok,
      platform,
      input: spec.kind === "hashtag"
        ? { hashtags: [handle], resultsPerPage: limit, shouldDownloadCovers: false }
        : { profiles: [handle], resultsPerPage: limit, profileSorting: "latest", shouldDownloadCovers: false },
    };
  }
  if (platform === "youtube") {
    const channel = /^UC[\w-]{20,}$/.test(handle) ? `https://www.youtube.com/channel/${handle}` : `https://www.youtube.com/@${handle}`;
    return {
      actor: APIFY_ACTORS.youtube,
      platform,
      input: { startUrls: [{ url: `${channel}/shorts` }, { url: `${channel}/videos` }], maxResults: limit, maxResultsShorts: limit, sortVideosBy: "NEWEST" },
    };
  }
  return null;
}

/** Одна ссылка на публикацию → запуск актора. */
export function buildUrlRun(url: string): ApifyRunSpec | null {
  const platform = detectUrlPlatform(url);
  if (!platform) return null;
  const clean = url.trim().replace(/[?#].*$/, "");
  if (platform === "instagram") {
    if (!/instagram\.com\/(p|reel|reels|tv)\//i.test(clean)) return null;
    return { actor: APIFY_ACTORS.instagram, platform, input: { directUrls: [clean], resultsType: "posts", resultsLimit: 1 } };
  }
  if (platform === "tiktok") {
    return { actor: APIFY_ACTORS.tiktok, platform, input: { postURLs: [url.trim()], resultsPerPage: 1, shouldDownloadCovers: false } };
  }
  if (platform === "youtube") {
    return { actor: APIFY_ACTORS.youtube, platform, input: { startUrls: [{ url: url.trim() }], maxResults: 1, maxResultsShorts: 1 } };
  }
  return null;
}

/**
 * Ответ актора → элементы для normalizeIngestItem. Профиль Instagram
 * (`details`) разворачивается в latestPosts с подписчиками владельца.
 */
export function flattenApifyItems(platform: RadarPlatform, items: unknown[], fallbackHandle?: string): Json[] {
  const out: Json[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Json;
    if (typeof it.error === "string" && !it.id && !it.shortCode && !it.url) continue;
    if (platform === "instagram" && Array.isArray(it.latestPosts)) {
      const owner = { ownerUsername: it.username ?? fallbackHandle ?? null, ownerFollowersCount: it.followersCount ?? null };
      for (const p of it.latestPosts) {
        if (p && typeof p === "object") out.push({ ...owner, ...(p as Json), platform });
      }
      continue;
    }
    if (platform === "youtube") {
      out.push({
        ...it,
        platform,
        media_type: it.type === "shorts" ? "shorts" : "video",
        author_handle: it.channelUsername ?? it.channelName ?? fallbackHandle ?? null,
        published_at: it.date ?? null,
        metrics: { likes: it.likes ?? 0, comments: it.commentsCount ?? 0, shares: 0, saves: 0, views: it.viewCount ?? 0 },
        followers: it.numberOfSubscribers ?? null,
        thumbnail_url: it.thumbnailUrl ?? null,
        caption: [it.title, it.text].filter((s) => typeof s === "string" && s.trim()).join("\n\n") || null,
      });
      continue;
    }
    out.push({ ...it, platform });
  }
  return out;
}

/** Оценка расхода запуска в USD по числу результатов. */
export function apifyCostUsd(actor: string, results: number): number {
  const per = APIFY_PRICE_PER_RESULT[actor] ?? 0.003;
  const cost = (APIFY_START_FEE[actor] ?? 0) + Math.max(results, 0) * per;
  return Math.round(cost * 10_000) / 10_000;
}

/** Ошибка HTTP от Apify → понятный текст для журнала сборов и источника. */
export function apifyHttpErrorMessage(status: number, body: string): string {
  let type = "";
  let message = "";
  try {
    const j = JSON.parse(body) as { error?: { type?: string; message?: string } };
    type = String(j?.error?.type ?? "");
    message = String(j?.error?.message ?? "");
  } catch {
    message = body.replace(/\s+/g, " ").trim().slice(0, 200);
  }
  if (status === 401 || type === "token-not-found" || type === "user-or-token-not-found") {
    return "Apify: токен не принят — проверьте секрет APIFY_TOKEN";
  }
  if (/usage.*limit/i.test(message) || type === "platform-feature-disabled") {
    return "Apify: месячный лимит расхода исчерпан — поднимите лимит или тариф в console.apify.com/billing";
  }
  if (status === 402 || /insufficient|balance|payment/i.test(message)) {
    return "Apify: нет средств на аккаунте — пополните баланс в console.apify.com/billing";
  }
  if (status === 429) return "Apify: слишком много запросов, повторите позже";
  if (status === 404 && type === "record-not-found") return "Apify: актор или запуск не найден";
  return `Apify HTTP ${status}${message ? `: ${message.slice(0, 200)}` : ""}`;
}

export type ApifyRunStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED";

export function isApifyRunFinished(status: string): boolean {
  return ["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(status);
}

export function apifyRunFailureMessage(status: string, statusMessage?: string | null): string {
  const base = status === "TIMED-OUT" ? "Apify: запуск не уложился в таймаут"
    : status === "ABORTED" ? "Apify: запуск прерван"
    : "Apify: запуск завершился ошибкой";
  return statusMessage ? `${base} (${String(statusMessage).slice(0, 200)})` : base;
}
