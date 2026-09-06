/**
 * OAuth площадок для очереди публикаций — чистая часть: адреса согласия,
 * запросы обмена кода и обновления токена, разбор ответов, идентичность
 * аккаунта. Без Supabase и без секретов внутри: ключи приложений передаются
 * параметрами (edge-функция берёт их из Deno.env). Тесты — src/test/publishOAuth.test.ts.
 *
 *   Threads: threads.net/oauth/authorize → graph.threads.net/oauth/access_token
 *            (1 ч) → th_exchange_token (60 дней) → th_refresh_token.
 *   TikTok:  tiktok.com/v2/auth/authorize → open.tiktokapis.com/v2/oauth/token
 *            (access 24 ч, refresh 365 дней) → grant_type=refresh_token.
 *   YouTube: accounts.google.com → oauth2.googleapis.com/token (access 1 ч,
 *            refresh бессрочный при access_type=offline).
 */

import { DEFAULT_TIKTOK_SCOPE } from "./tiktokApi.ts";

export type OAuthPlatform = "threads" | "tiktok" | "youtube";
export const OAUTH_PLATFORMS: readonly OAuthPlatform[] = ["threads", "tiktok", "youtube"];

export function isOAuthPlatform(v: unknown): v is OAuthPlatform {
  return typeof v === "string" && (OAUTH_PLATFORMS as readonly string[]).includes(v);
}

/**
 * Instagram по ссылке-приглашению: клиент входит в свой Facebook, мы забираем
 * его страницы и подключаем привязанный Instagram Business. Отличается от
 * трёх площадок выше тем, что аккаунт не один — сначала список страниц, потом
 * выбор, — поэтому в общий OAuthPlatform не входит и живёт отдельными
 * функциями (meta*). Токен страницы не истекает, refresh не нужен.
 */
export type ConnectPlatform = OAuthPlatform | "instagram";
export const CONNECT_PLATFORMS: readonly ConnectPlatform[] = ["instagram", "tiktok", "youtube", "threads"];

export function isConnectPlatform(v: unknown): v is ConnectPlatform {
  return typeof v === "string" && (CONNECT_PLATFORMS as readonly string[]).includes(v);
}

/** Права Meta, которых хватает ровно на публикацию в Instagram и чтение статистики. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
].join(",");

export const META_GRAPH = "https://graph.facebook.com/v21.0";

export function metaAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", META_SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", p.state);
  return u.toString();
}

export function metaCodeExchangeUrl(p: AppCredentials & { code: string; redirectUri: string }): string {
  const u = new URL(`${META_GRAPH}/oauth/access_token`);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("client_secret", p.clientSecret);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("code", p.code);
  return u.toString();
}

/** Короткий пользовательский токен → долгий (60 дней). Page-токены из него уже бессрочные. */
export function metaLongLivedUrl(p: AppCredentials & { shortToken: string }): string {
  const u = new URL(`${META_GRAPH}/oauth/access_token`);
  u.searchParams.set("grant_type", "fb_exchange_token");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("client_secret", p.clientSecret);
  u.searchParams.set("fb_exchange_token", p.shortToken);
  return u.toString();
}

export function metaPagesUrl(userToken: string): string {
  const u = new URL(`${META_GRAPH}/me/accounts`);
  u.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count}",
  );
  u.searchParams.set("limit", "100");
  u.searchParams.set("access_token", userToken);
  return u.toString();
}

export interface MetaPageOption {
  page_id: string;
  page_name: string | null;
  ig_user_id: string | null;
  ig_username: string | null;
  ig_name: string | null;
  ig_avatar_url: string | null;
  ig_followers: number | null;
  /** Страница без Instagram Business/Creator публиковать не может. */
  connectable: boolean;
  page_token: string | null;
}

/** Ответ /me/accounts → список страниц для выбора. Страницы без токена бесполезны. */
export function parseMetaPages(body: unknown): MetaPageOption[] {
  const rows = ((body ?? {}) as { data?: unknown }).data;
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const ig = (p.instagram_business_account ?? null) as Record<string, unknown> | null;
    const pageToken = typeof p.access_token === "string" ? p.access_token : null;
    return {
      page_id: String(p.id ?? ""),
      page_name: typeof p.name === "string" ? p.name : null,
      ig_user_id: ig?.id ? String(ig.id) : null,
      ig_username: typeof ig?.username === "string" ? ig.username : null,
      ig_name: typeof ig?.name === "string" ? ig.name : null,
      ig_avatar_url: typeof ig?.profile_picture_url === "string" ? ig.profile_picture_url : null,
      ig_followers: typeof ig?.followers_count === "number" ? ig.followers_count : null,
      connectable: Boolean(ig?.id && pageToken),
      page_token: pageToken,
    };
  }).filter((p) => p.page_id);
}

export const SCOPES: Record<OAuthPlatform, string> = {
  threads: "threads_basic,threads_content_publish",
  // Login Kit + Display API + Content Posting API — каталог в tiktokApi.ts.
  tiktok: DEFAULT_TIKTOK_SCOPE,
  youtube: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
};

/** Права, без которых публикация невозможна (сверяются с scope в ответе токена). */
export const REQUIRED_SCOPE: Record<OAuthPlatform, string> = {
  threads: "threads_content_publish",
  tiktok: "video.publish",
  youtube: "youtube.upload",
};

export interface AppCredentials {
  clientId: string;
  clientSecret: string;
}

/** `scope` переопределяет набор прав площадки (TikTok: секрет TIKTOK_SCOPES для песочницы с урезанными продуктами). */
export function authorizeUrl(platform: OAuthPlatform, p: { clientId: string; redirectUri: string; state: string; scope?: string }): string {
  if (platform === "threads") {
    const u = new URL("https://threads.net/oauth/authorize");
    u.searchParams.set("client_id", p.clientId);
    u.searchParams.set("redirect_uri", p.redirectUri);
    u.searchParams.set("scope", SCOPES.threads);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", p.state);
    return u.toString();
  }
  if (platform === "tiktok") {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", p.clientId);
    u.searchParams.set("scope", p.scope?.trim() || SCOPES.tiktok);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", p.redirectUri);
    u.searchParams.set("state", p.state);
    return u.toString();
  }
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", SCOPES.youtube);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", p.state);
  return u.toString();
}

export interface TokenRequest {
  url: string;
  init: RequestInit;
}

function form(body: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  };
}

export function codeExchangeRequest(platform: OAuthPlatform, p: AppCredentials & { code: string; redirectUri: string }): TokenRequest {
  if (platform === "threads") {
    return {
      url: "https://graph.threads.net/oauth/access_token",
      init: form({ client_id: p.clientId, client_secret: p.clientSecret, grant_type: "authorization_code", redirect_uri: p.redirectUri, code: p.code }),
    };
  }
  if (platform === "tiktok") {
    return {
      url: "https://open.tiktokapis.com/v2/oauth/token/",
      init: form({ client_key: p.clientId, client_secret: p.clientSecret, code: p.code, grant_type: "authorization_code", redirect_uri: p.redirectUri }),
    };
  }
  return {
    url: "https://oauth2.googleapis.com/token",
    init: form({ code: p.code, client_id: p.clientId, client_secret: p.clientSecret, redirect_uri: p.redirectUri, grant_type: "authorization_code" }),
  };
}

/** Обновление токена. Threads обновляется самим long-lived токеном (без refresh_token). */
export function refreshRequest(platform: OAuthPlatform, p: AppCredentials & { refreshToken: string }): TokenRequest {
  if (platform === "threads") {
    return {
      url: `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(p.refreshToken)}`,
      init: { method: "GET" },
    };
  }
  if (platform === "tiktok") {
    return {
      url: "https://open.tiktokapis.com/v2/oauth/token/",
      init: form({ client_key: p.clientId, client_secret: p.clientSecret, grant_type: "refresh_token", refresh_token: p.refreshToken }),
    };
  }
  return {
    url: "https://oauth2.googleapis.com/token",
    init: form({ client_id: p.clientId, client_secret: p.clientSecret, grant_type: "refresh_token", refresh_token: p.refreshToken }),
  };
}

/** Threads: короткий токен (1 ч) → long-lived (60 дней). */
export function threadsLongLivedRequest(p: { clientSecret: string; accessToken: string }): TokenRequest {
  return {
    url: `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(p.clientSecret)}&access_token=${encodeURIComponent(p.accessToken)}`,
    init: { method: "GET" },
  };
}

export interface ParsedToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string | null;
  externalId: string | null;
}

/** Ответ токен-эндпоинта → единый вид; null, если токена нет. */
export function parseTokenResponse(platform: OAuthPlatform, body: unknown, now = Date.now()): ParsedToken | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = (platform === "tiktok" && b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token : null;
  if (!accessToken) return null;
  const expiresIn = Number(data.expires_in ?? (platform === "threads" ? 3600 : platform === "tiktok" ? 86400 : 3600));
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresAt: new Date(now + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString(),
    scope: typeof data.scope === "string" ? data.scope : null,
    externalId: typeof data.open_id === "string" ? data.open_id : typeof data.user_id === "string" || typeof data.user_id === "number" ? String(data.user_id) : null,
  };
}

export function tokenError(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const err = b.error;
  if (typeof err === "string") return `${err}${b.error_description ? `: ${b.error_description}` : ""}`;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (e.code && e.code !== "ok") return `${e.code}${e.message ? `: ${e.message}` : ""}`;
    if (e.message) return String(e.message);
  }
  return null;
}

export function hasRequiredScope(platform: OAuthPlatform, scope: string | null): boolean {
  if (!scope) return true; // площадка не вернула scope — проверим при первой публикации
  return scope.includes(REQUIRED_SCOPE[platform]);
}

/** Токен нужно обновить, если он истекает в ближайшие marginSec секунд (или уже истёк). */
export function tokenNeedsRefresh(expiresAt: string | null | undefined, now = Date.now(), marginSec = 600): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) ? false : t - now < marginSec * 1000;
}

export interface Identity {
  externalId: string;
  name: string;
  handle: string | null;
}

export function identityRequest(platform: OAuthPlatform, accessToken: string): TokenRequest {
  if (platform === "threads") {
    return { url: `https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=${encodeURIComponent(accessToken)}`, init: { method: "GET" } };
  }
  if (platform === "tiktok") {
    return {
      url: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,username,avatar_url",
      init: { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    };
  }
  return {
    url: "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    init: { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
  };
}

export function parseIdentity(platform: OAuthPlatform, body: unknown): Identity | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (platform === "threads") {
    if (!b.id) return null;
    return { externalId: String(b.id), name: String(b.name ?? b.username ?? "Threads"), handle: b.username ? String(b.username) : null };
  }
  if (platform === "tiktok") {
    const u = ((b.data as Record<string, unknown> | undefined)?.user ?? {}) as Record<string, unknown>;
    if (!u.open_id) return null;
    return { externalId: String(u.open_id), name: String(u.display_name ?? u.username ?? "TikTok"), handle: u.username ? String(u.username) : null };
  }
  const item = ((b.items as Record<string, unknown>[] | undefined) ?? [])[0];
  if (!item?.id) return null;
  const sn = (item.snippet ?? {}) as Record<string, unknown>;
  return { externalId: String(item.id), name: String(sn.title ?? "YouTube"), handle: sn.customUrl ? String(sn.customUrl) : null };
}

/** Адрес возврата в приложение с результатом. */
export function returnUrlWith(returnUrl: string, params: Record<string, string>): string {
  const u = new URL(returnUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}


/* ─────────────────── Instagram Login (вход в сам Instagram) ─────────────────── */

/**
 * Вторая дверь в Instagram: «Instagram API with Instagram Login» — человек
 * входит логином самого Instagram, без Facebook-страницы и без Business
 * Manager. Аккаунту достаточно быть профессиональным (Business/Creator).
 *
 * Отличия от входа через Facebook (meta* выше):
 *   - один аккаунт вместо списка страниц — выбирать нечего;
 *   - токен живёт 60 дней и продлевается (ig_refresh_token), а не бессрочный
 *     page-токен;
 *   - публикация идёт на graph.instagram.com (publishers/instagram.ts уже
 *     умеет обе формы токена — различает по префиксу IGAA…/EAA…);
 *   - ключи приложения свои: INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET
 *     (в карточке приложения Meta это раздел Instagram → API setup with
 *     Instagram login, а не Facebook Login).
 */
export const INSTAGRAM_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
].join(",");

/** Право, без которого публиковать нечем. */
export const INSTAGRAM_LOGIN_REQUIRED_SCOPE = "instagram_business_content_publish";

export const GRAPH_IG = "https://graph.instagram.com/v21.0";

export function instagramLoginAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string; scope?: string }): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", p.scope?.trim() || INSTAGRAM_LOGIN_SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", p.state);
  return u.toString();
}

/**
 * Instagram возвращает code с хвостом `#_` — фрагментом, который до сервера
 * обычно не доходит, но в части браузеров приезжает внутри значения. Обмен с
 * таким хвостом отвечает «Invalid authorization code», поэтому режем.
 */
export function cleanInstagramCode(code: string): string {
  return code.replace(/#_+$/, "");
}

export function instagramLoginCodeExchangeRequest(p: AppCredentials & { code: string; redirectUri: string }): TokenRequest {
  return {
    url: "https://api.instagram.com/oauth/access_token",
    init: form({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: p.redirectUri,
      code: cleanInstagramCode(p.code),
    }),
  };
}

/** Короткий токен (1 ч) → долгий (60 дней). Дальше продлевается ig_refresh_token. */
export function instagramLongLivedUrl(p: { clientSecret: string; shortToken: string }): string {
  const u = new URL("https://graph.instagram.com/access_token");
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", p.clientSecret);
  u.searchParams.set("access_token", p.shortToken);
  return u.toString();
}

/** Продление долгого токена (можно с 24-го часа жизни, обязательно до 60 дней). */
export function instagramRefreshUrl(accessToken: string): string {
  const u = new URL("https://graph.instagram.com/refresh_access_token");
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", accessToken);
  return u.toString();
}

export function instagramMeUrl(accessToken: string): string {
  const u = new URL(`${GRAPH_IG}/me`);
  u.searchParams.set("fields", "user_id,username,name,profile_picture_url,followers_count,account_type");
  u.searchParams.set("access_token", accessToken);
  return u.toString();
}

export interface InstagramLoginToken {
  accessToken: string;
  userId: string | null;
  scope: string | null;
  expiresAt: string;
}

/**
 * Ответ обмена кода Instagram Login → единый вид. Права площадка отдаёт в
 * `permissions` (массивом или строкой), а не в `scope`, — приводим к строке,
 * чтобы дальше жить общей проверкой прав.
 */
export function parseInstagramLoginToken(body: unknown, now = Date.now()): InstagramLoginToken | null {
  const b = ((body ?? {}) as Record<string, unknown>);
  const data = (Array.isArray(b.data) ? (b.data[0] ?? {}) : b) as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token : null;
  if (!accessToken) return null;
  const perms = data.permissions ?? data.scope;
  const scope = Array.isArray(perms) ? perms.join(",") : typeof perms === "string" ? perms : null;
  const expiresIn = Number(data.expires_in ?? 3600);
  return {
    accessToken,
    userId: data.user_id != null ? String(data.user_id) : null,
    scope: scope && scope.trim() ? scope : null,
    expiresAt: new Date(now + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString(),
  };
}

export interface InstagramProfile {
  externalId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  followers: number | null;
  /** BUSINESS / MEDIA_CREATOR / PERSONAL — личный профиль публиковать не может. */
  accountType: string | null;
}

export function parseInstagramProfile(body: unknown): InstagramProfile | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = b.user_id ?? b.id;
  if (!id) return null;
  return {
    externalId: String(id),
    username: typeof b.username === "string" ? b.username : null,
    name: typeof b.name === "string" ? b.name : null,
    avatarUrl: typeof b.profile_picture_url === "string" ? b.profile_picture_url : null,
    followers: typeof b.followers_count === "number" ? b.followers_count : null,
    accountType: typeof b.account_type === "string" ? b.account_type : null,
  };
}

/** Права Instagram Login: пусто — площадка не сказала, проверим при первой публикации. */
export function hasInstagramPublishScope(scope: string | null): boolean {
  if (!scope) return true;
  return scope.includes(INSTAGRAM_LOGIN_REQUIRED_SCOPE) || scope.includes("instagram_content_publish");
}
