/**
 * API-ключи проекта: генерация, хэширование, разбор заголовка и проверка
 * по таблице api_keys. Ключ выдаётся один раз, в базе лежит только sha256.
 *
 * Здесь только чистые функции (без базы) — их гоняет vitest; проверка ключа
 * по таблице — рядом, в apiKeysDb.ts.
 */
export const API_KEY_PREFIX = "mv_live_";
/** Сколько символов ключа показываем в списке, чтобы узнать его. */
export const API_KEY_VISIBLE = 16;

export type ApiScope = "read" | "publish" | "manage";
export const ALL_SCOPES: readonly ApiScope[] = ["read", "publish", "manage"] as const;

export interface ApiKeyContext {
  keyId: string;
  projectId: string;
  name: string;
  scopes: ApiScope[];
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Новый ключ: префикс + 32 случайных байта. Возвращает и то, что покажем в списке. */
export function generateApiKey(): { key: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = `${API_KEY_PREFIX}${base64url(bytes)}`;
  return { key, prefix: key.slice(0, API_KEY_VISIBLE) };
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length > API_KEY_PREFIX.length + 20;
}

/** Ключ из `Authorization: Bearer mv_live_…` или `x-api-key`. */
export function extractApiKey(headers: Headers): string | null {
  const direct = headers.get("x-api-key")?.trim();
  if (direct && looksLikeApiKey(direct)) return direct;
  const auth = headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  if (m && looksLikeApiKey(m[1])) return m[1];
  return null;
}

/** Неизвестные scope отбрасываем; пусто → все. */
export function normalizeScopes(input: unknown): ApiScope[] {
  if (!Array.isArray(input)) return [...ALL_SCOPES];
  const picked = input.map(String).filter((s): s is ApiScope => (ALL_SCOPES as readonly string[]).includes(s));
  return picked.length ? Array.from(new Set(picked)) : [...ALL_SCOPES];
}

/** publish и manage включают в себя read. */
export function hasScope(scopes: readonly string[], need: ApiScope): boolean {
  if (scopes.includes(need)) return true;
  return need === "read" && (scopes.includes("publish") || scopes.includes("manage"));
}

/* ───────────── лимит запросов: окно в минуту на ключ, в памяти изолята ───────────── */

export const RATE_LIMIT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

export interface RateBucket { windowStart: number; count: number }

/** true — запрос можно пропустить. Хранилище передаётся снаружи, чтобы тестировать без времени. */
export function checkRateLimit(
  store: Map<string, RateBucket>, keyId: string, now = Date.now(), limit = RATE_LIMIT_PER_MINUTE,
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const cur = store.get(keyId);
  const bucket = cur && now - cur.windowStart < WINDOW_MS ? cur : { windowStart: now, count: 0 };
  const next = { ...bucket, count: bucket.count + 1 };
  store.set(keyId, next);
  const allowed = next.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - next.count),
    retryAfterSec: allowed ? 0 : Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000),
  };
}
