/**
 * Чистая часть контура автопубликации: площадки, шифрование токенов и склейка
 * подписи.
 *
 * Отдельно от publishing.ts, потому что тот тянет клиент Supabase: этот модуль
 * импортируется и вне Deno — из unit-тестов (src/test/publishing.test.ts).
 */

export type Platform = "instagram" | "tiktok" | "youtube" | "threads";

export const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "threads"];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

/* ─────────────────────────── шифрование токенов ────────────────────────── */

// Токены площадок лежат в БД шифротекстом: право SELECT на эти колонки не
// выдано никому, кроме сервисной роли, а сам ключ живёт в секретах Supabase.
// Формат: 'v1:<base64(iv|ciphertext)>'. Значение без префикса — открытый
// токен из legacy-таблицы instagram_accounts, читаем как есть.
const ENC_PREFIX = "v1:";

/** Ключ читаем лениво: модуль должен импортироваться и вне Deno (unit-тесты). */
function tokenKey(): string {
  const runtime = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  return runtime?.env.get("PUBLISH_TOKEN_KEY") ?? "";
}

export function tokenKeyConfigured(): boolean {
  return tokenKey().length > 0;
}

async function aesKey(): Promise<CryptoKey> {
  // Ключ произвольной длины сворачиваем в 256 бит — секрет можно задать любой строкой.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tokenKey()));
  return await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!tokenKeyConfigured()) {
    throw new Error("PUBLISH_TOKEN_KEY не задан в секретах Supabase — токены сохранять некуда");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(plain)),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  return ENC_PREFIX + toBase64(packed);
}

export async function decryptSecret(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy: открытый токен
  if (!tokenKeyConfigured()) {
    throw new Error("PUBLISH_TOKEN_KEY не задан — зашифрованный токен не прочитать");
  }
  const packed = fromBase64(stored.slice(ENC_PREFIX.length));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, 12) },
    await aesKey(),
    packed.slice(12),
  );
  return new TextDecoder().decode(plain);
}

/* ──────────────────────────────── тексты ───────────────────────────────── */

/** Подпись = текст + хэштеги; площадки не любят пустую строку в caption. */
export function composeCaption(caption: string | null, hashtags: string[]): string {
  const tags = (hashtags ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  const body = (caption ?? "").trim();
  if (!tags.length) return body;
  return body ? `${body}\n\n${tags.join(" ")}` : tags.join(" ");
}
