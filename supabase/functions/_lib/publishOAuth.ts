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

export type OAuthPlatform = "threads" | "tiktok" | "youtube";
export const OAUTH_PLATFORMS: readonly OAuthPlatform[] = ["threads", "tiktok", "youtube"];

export function isOAuthPlatform(v: unknown): v is OAuthPlatform {
  return typeof v === "string" && (OAUTH_PLATFORMS as readonly string[]).includes(v);
}

export const SCOPES: Record<OAuthPlatform, string> = {
  threads: "threads_basic,threads_content_publish",
  tiktok: "user.info.basic,video.publish,video.upload,video.list",
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

export function authorizeUrl(platform: OAuthPlatform, p: { clientId: string; redirectUri: string; state: string }): string {
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
    u.searchParams.set("scope", SCOPES.tiktok);
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
