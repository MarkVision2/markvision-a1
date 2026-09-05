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
  threads: "thenetaji~threads-scraper",
  facebook: "apify~facebook-posts-scraper",
  /** Библиотека рекламы Meta (Facebook + Instagram). */
  adLibrary: "apify~facebook-ads-scraper",
} as const;

/** Цена за результат (USD, тариф FREE — верхняя оценка) + плата за старт актора. */
const APIFY_PRICE_PER_RESULT: Record<string, number> = {
  [APIFY_ACTORS.instagram]: 0.0027,
  [APIFY_ACTORS.tiktok]: 0.0037,
  [APIFY_ACTORS.youtube]: 0.004,
  [APIFY_ACTORS.threads]: 0.004,
  [APIFY_ACTORS.facebook]: 0.005,
  [APIFY_ACTORS.adLibrary]: 0.0058,
};
const APIFY_START_FEE: Record<string, number> = {
  [APIFY_ACTORS.tiktok]: 0.001,
  [APIFY_ACTORS.facebook]: 0.001,
  [APIFY_ACTORS.threads]: 0.00005,
};

const AD_LIBRARY_BASE = "https://www.facebook.com/ads/library/";

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
  if (spec.kind === "ad_library_query") {
    if (spec.platform !== "facebook" && spec.platform !== "instagram") return "библиотека рекламы есть только у Facebook и Instagram";
    if (!spec.handle.trim()) return "пустой запрос";
    return null;
  }
  if (spec.kind === "hashtag" && (spec.platform === "threads" || spec.platform === "facebook")) {
    return `хештеги ${spec.platform === "threads" ? "Threads" : "Facebook"} не поддерживаются — добавьте аккаунт`;
  }
  if (!cleanHandle(spec.handle)) return "пустой ник";
  return null;
}

/**
 * Запрос в Библиотеке рекламы Meta → ссылка для актора: готовая ссылка на
 * Ad Library или страницу Facebook проходит как есть, иначе поиск по ключевым
 * словам (по всем странам; для Instagram — только объявления Instagram).
 */
export function adLibraryUrl(query: string, platform: string): string {
  const q = query.trim();
  if (/^https?:\/\/(www\.)?facebook\.com\//i.test(q)) return q;
  const params = new URLSearchParams({
    active_status: "active", ad_type: "all", country: "ALL", media_type: "all",
    q, search_type: "keyword_unordered",
  });
  if (platform === "instagram") params.set("publisher_platforms[0]", "instagram");
  return `${AD_LIBRARY_BASE}?${params.toString()}`;
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
  if (spec.kind === "ad_library_query") {
    return { actor: APIFY_ACTORS.adLibrary, platform, input: { startUrls: [{ url: adLibraryUrl(spec.handle, platform) }], resultsLimit: limit } };
  }
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
    if (spec.kind === "hashtag") {
      return {
        actor: APIFY_ACTORS.youtube,
        platform,
        input: { startUrls: [{ url: `https://www.youtube.com/hashtag/${handle}` }], maxResults: limit, maxResultsShorts: limit },
      };
    }
    const channel = /^UC[\w-]{20,}$/.test(handle) ? `https://www.youtube.com/channel/${handle}` : `https://www.youtube.com/@${handle}`;
    return {
      actor: APIFY_ACTORS.youtube,
      platform,
      input: { startUrls: [{ url: `${channel}/shorts` }, { url: `${channel}/videos` }], maxResults: limit, maxResultsShorts: limit, sortVideosBy: "NEWEST" },
    };
  }
  if (platform === "threads") {
    return { actor: APIFY_ACTORS.threads, platform, input: { input: [{ url: `https://www.threads.net/@${handle}` }], maxThreads: limit } };
  }
  if (platform === "facebook") {
    const page = /^https?:\/\//i.test(spec.handle.trim()) ? spec.handle.trim() : `https://www.facebook.com/${handle}/`;
    return { actor: APIFY_ACTORS.facebook, platform, input: { startUrls: [{ url: page }], resultsLimit: limit, onlyPostsNewerThan: "30 days" } };
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
  if (platform === "threads") {
    if (!/threads\.(net|com)\/@[^/]+\/post\//i.test(clean)) return null;
    return { actor: APIFY_ACTORS.threads, platform, input: { input: [{ url: clean }], maxThreads: 1 } };
  }
  if (platform === "facebook") {
    if (/facebook\.com\/ads\/library/i.test(clean)) {
      return { actor: APIFY_ACTORS.adLibrary, platform, input: { startUrls: [{ url: url.trim() }], resultsLimit: 1 } };
    }
    return { actor: APIFY_ACTORS.facebook, platform, input: { startUrls: [{ url: clean }], resultsLimit: 1 } };
  }
  return null;
}

/**
 * Ответ актора → элементы для normalizeIngestItem. Профиль Instagram
 * (`details`) разворачивается в latestPosts с подписчиками владельца.
 */
export function flattenApifyItems(platform: RadarPlatform, items: unknown[], fallbackHandle?: string, kind?: string): Json[] {
  const out: Json[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Json;
    if (typeof it.error === "string" && !it.id && !it.shortCode && !it.url && !it.adArchiveID) continue;
    if (kind === "ad_library_query" || it.adArchiveID != null || (it.snapshot && typeof it.snapshot === "object")) {
      const ad = flattenAdLibraryItem(platform, it);
      if (ad) out.push(ad);
      continue;
    }
    if (platform === "threads") {
      out.push(...flattenThreadsItem(it, fallbackHandle));
      continue;
    }
    if (platform === "facebook") {
      out.push(flattenFacebookPost(it, fallbackHandle));
      continue;
    }
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

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const first = (v: unknown): Json => (Array.isArray(v) && v.length ? obj(v[0]) : {});
const firstText = (...vals: unknown[]): string | null => {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
};
const sumNums = (...vals: unknown[]): number => vals.reduce<number>((acc, v) => acc + (Number(v) || 0), 0);

/** Объявление из Библиотеки рекламы Meta (apify/facebook-ads-scraper) → элемент ingest. Реакций у объявлений нет. */
function flattenAdLibraryItem(platform: RadarPlatform, it: Json): Json | null {
  const snap = obj(it.snapshot);
  const cards = Array.isArray(snap.cards) ? snap.cards.map(obj) : [];
  const video = first(snap.videos);
  const image = first(snap.images);
  const card = cards[0] ?? {};
  const id = firstText(it.adArchiveID, it.ad_archive_id, it.adid, it.id);
  if (!id) return null;
  const body = obj(snap.body);
  return {
    platform,
    external_id: `ad-${id}`,
    url: `${AD_LIBRARY_BASE}?id=${encodeURIComponent(id)}`,
    author_handle: firstText(it.pageName, snap.page_name, snap.instagram_actor_name),
    published_at: it.startDate ?? it.start_date ?? null,
    media_type: video.video_hd_url || video.video_sd_url || card.video_hd_url ? "video" : "ad",
    caption: [firstText(snap.title, card.title), firstText(body.text, card.body, snap.caption), firstText(snap.cta_text)]
      .filter(Boolean).join("\n\n") || null,
    video_url: firstText(video.video_hd_url, video.video_sd_url, card.video_hd_url, card.video_sd_url),
    thumbnail_url: firstText(video.video_preview_image_url, image.original_image_url, image.resized_image_url, card.original_image_url, card.resized_image_url),
    metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 0 },
    followers: snap.page_like_count ?? null,
    raw: it,
  };
}

/** Пост Threads (thenetaji/threads-scraper — объекты GraphQL Threads) → элементы ingest; профиль разворачивается в посты. */
function flattenThreadsItem(it: Json, fallbackHandle?: string): Json[] {
  const nested = (["threads", "posts", "items", "latestPosts"] as const).map((k) => it[k]).find(Array.isArray) as unknown[] | undefined;
  if (nested) {
    const owner = firstText(it.username, obj(it.user).username, fallbackHandle);
    const followers = it.follower_count ?? it.followers ?? it.followersCount ?? obj(it.user).follower_count ?? null;
    return nested.filter((p) => p && typeof p === "object").map((p) => threadsPost(obj(p), owner, followers));
  }
  return [threadsPost(it, fallbackHandle ?? null, null)];
}

function threadsPost(p: Json, ownerHandle: string | null, ownerFollowers: unknown): Json {
  const post = Object.keys(obj(p.post)).length ? obj(p.post) : p;
  const user = obj(post.user);
  const info = obj(post.text_post_app_info);
  const username = firstText(user.username, post.username, post.author_handle, ownerHandle);
  const code = firstText(post.code, post.shortcode);
  const video = first(post.video_versions);
  const image = first(obj(post.image_versions2).candidates);
  return {
    platform: "threads",
    external_id: firstText(post.id, post.pk, code),
    url: firstText(post.url, post.permalink) ?? (username && code ? `https://www.threads.net/@${username}/post/${code}` : null),
    author_handle: username,
    published_at: post.taken_at ?? post.timestamp ?? post.published_at ?? null,
    media_type: video.url ? "video" : "text",
    caption: firstText(post.text, obj(post.caption).text, post.caption),
    video_url: firstText(video.url),
    thumbnail_url: firstText(image.url, post.thumbnail_url),
    metrics: {
      likes: sumNums(post.like_count ?? post.likes ?? post.likeCount),
      comments: sumNums(info.direct_reply_count ?? post.reply_count ?? post.replies ?? post.replyCount),
      shares: sumNums(info.repost_count ?? post.repost_count ?? post.reposts, info.quote_count ?? post.quote_count),
      saves: 0,
      views: sumNums(post.view_count ?? post.views),
    },
    followers: user.follower_count ?? post.followers ?? ownerFollowers ?? null,
    raw: p,
  };
}

/** Пост страницы Facebook (apify/facebook-posts-scraper) → элемент ingest. */
function flattenFacebookPost(it: Json, fallbackHandle?: string): Json {
  const media = first(it.media);
  return {
    platform: "facebook",
    external_id: firstText(it.postId, it.post_id, it.id, it.facebookId),
    url: firstText(it.url, it.topLevelUrl, it.postUrl),
    author_handle: firstText(it.pageName, obj(it.user).name, it.username, fallbackHandle),
    published_at: it.time ?? it.timestamp ?? it.publishedAt ?? null,
    media_type: it.isVideo || it.videoUrl ? "video" : "post",
    caption: firstText(it.text, it.message, it.caption),
    video_url: firstText(it.videoUrl, obj(it.video).url),
    thumbnail_url: firstText(media.thumbnail, obj(media.photo_image).uri, it.thumbnailUrl),
    metrics: {
      likes: sumNums(it.likes ?? it.reactions ?? it.topReactionsCount),
      comments: sumNums(it.comments ?? it.commentsCount),
      shares: sumNums(it.shares ?? it.sharesCount),
      saves: 0,
      views: sumNums(it.viewsCount ?? it.views ?? it.videoViewCount),
    },
    followers: it.pageLikes ?? it.pageFollowers ?? it.followers ?? null,
    raw: it,
  };
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
