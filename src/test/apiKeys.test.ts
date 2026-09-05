/**
 * API-ключи: формат, хэш, разбор заголовков, права и лимит запросов.
 * Ошибка здесь не падает громко — просто чужой ключ проходит или свой нет.
 */
import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  checkRateLimit,
  extractApiKey,
  generateApiKey,
  hasScope,
  hashApiKey,
  looksLikeApiKey,
  normalizeScopes,
  type RateBucket,
} from "../../supabase/functions/_lib/apiKeys.ts";

describe("generateApiKey", () => {
  it("ключ с префиксом, уникальный, префикс для списка — начало ключа", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.key).not.toBe(b.key);
    expect(a.key.startsWith(a.prefix)).toBe(true);
    expect(a.prefix.length).toBeLessThan(a.key.length);
    expect(looksLikeApiKey(a.key)).toBe(true);
  });

  it("хэш детерминирован и не равен ключу", async () => {
    const { key } = generateApiKey();
    const h1 = await hashApiKey(key);
    const h2 = await hashApiKey(key);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toContain(key);
  });
});

describe("extractApiKey", () => {
  const { key } = generateApiKey();

  it("берёт Bearer и x-api-key, x-api-key в приоритете", () => {
    expect(extractApiKey(new Headers({ authorization: `Bearer ${key}` }))).toBe(key);
    expect(extractApiKey(new Headers({ "x-api-key": key }))).toBe(key);
    const other = generateApiKey().key;
    expect(extractApiKey(new Headers({ "x-api-key": other, authorization: `Bearer ${key}` }))).toBe(other);
  });

  it("JWT пользователя в Bearer — не ключ", () => {
    expect(extractApiKey(new Headers({ authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc" }))).toBeNull();
    expect(extractApiKey(new Headers({ "x-api-key": "mv_live_short" }))).toBeNull();
    expect(extractApiKey(new Headers())).toBeNull();
  });
});

describe("scopes", () => {
  it("publish и manage включают read, но не друг друга", () => {
    expect(hasScope(["publish"], "read")).toBe(true);
    expect(hasScope(["manage"], "read")).toBe(true);
    expect(hasScope(["publish"], "publish")).toBe(true);
    expect(hasScope(["publish"], "manage")).toBe(false);
    expect(hasScope(["manage"], "publish")).toBe(false);
    expect(hasScope(["read"], "publish")).toBe(false);
    expect(hasScope([], "read")).toBe(false);
  });

  it("нормализация: мусор отбрасывается, пусто — все права", () => {
    expect(normalizeScopes(["read", "admin", "read"])).toEqual(["read"]);
    expect(normalizeScopes(undefined)).toEqual(["read", "publish", "manage"]);
    expect(normalizeScopes(["nope"])).toEqual(["read", "publish", "manage"]);
  });
});

describe("checkRateLimit", () => {
  it("пропускает до лимита, потом отказывает до конца минуты", () => {
    const store = new Map<string, RateBucket>();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit(store, "k", t0 + i, 3).allowed).toBe(true);
    const denied = checkRateLimit(store, "k", t0 + 10_000, 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBe(50);
    expect(checkRateLimit(store, "k", t0 + 60_000, 3).allowed).toBe(true);
  });

  it("ключи считаются отдельно", () => {
    const store = new Map<string, RateBucket>();
    expect(checkRateLimit(store, "a", 0, 1).allowed).toBe(true);
    expect(checkRateLimit(store, "a", 1, 1).allowed).toBe(false);
    expect(checkRateLimit(store, "b", 1, 1).allowed).toBe(true);
  });
});
