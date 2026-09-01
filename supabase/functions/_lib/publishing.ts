/**
 * Общая часть контура автопубликации (docs/PUBLISHING-SYSTEM.md).
 *
 * Здесь всё, что нужно и воркеру очереди, и HTTP-endpoint'у публикации:
 * шифрование токенов аккаунтов, журнал ответов площадок, статусы аккаунтов
 * и уведомления в Telegram проекта.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

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
const TOKEN_KEY = Deno.env.get("PUBLISH_TOKEN_KEY") ?? "";
const ENC_PREFIX = "v1:";

export function tokenKeyConfigured(): boolean {
  return TOKEN_KEY.length > 0;
}

async function aesKey(): Promise<CryptoKey> {
  // Ключ произвольной длины сворачиваем в 256 бит — секрет можно задать любой строкой.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN_KEY));
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

/* ────────────────────────────── строки таблиц ──────────────────────────── */

export interface PublishAccount {
  id: string;
  project_id: string;
  platform: Platform;
  account_name: string;
  handle: string | null;
  external_account_id: string;
  fb_page_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  status: "active" | "token_expired" | "limited" | "error" | "disabled";
  publish_enabled: boolean;
  daily_limit: number;
  last_post_at: string | null;
  consecutive_errors: number;
  last_error: string | null;
}

export interface PublishJob {
  id: string;
  project_id: string;
  video_id: string;
  account_id: string;
  platform: Platform;
  caption: string | null;
  hashtags: string[];
  attempts: number;
  container_id: string | null;
}

export interface PublishVideo {
  id: string;
  project_id: string;
  file_url: string;
  thumbnail_url: string | null;
  title: string | null;
  base_caption: string | null;
  caption_variants: string[];
  hashtags: string[];
}

/* ───────────────────────────────── журнал ──────────────────────────────── */

export async function logJob(
  admin: SupabaseClient,
  entry: {
    jobId?: string | null;
    accountId?: string | null;
    level?: "info" | "warning" | "error";
    message: string;
    raw?: unknown;
  },
): Promise<void> {
  // Журнал не должен ронять публикацию: пишем «как получится».
  await admin.from("publish_logs").insert({
    job_id: entry.jobId ?? null,
    account_id: entry.accountId ?? null,
    level: entry.level ?? "info",
    message: entry.message.slice(0, 2000),
    raw_response: entry.raw === undefined ? null : (entry.raw as Record<string, unknown>),
  }).then(() => {}, () => {});
}

/* ─────────────────────────────── Telegram ──────────────────────────────── */

export async function notifyProject(
  admin: SupabaseClient,
  projectId: string,
  text: string,
): Promise<void> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!botToken) return;
  const { data } = await admin
    .from("telegram_links").select("chat_id").eq("project_id", projectId).limit(1).maybeSingle();
  const chatId = (data as { chat_id?: string } | null)?.chat_id;
  if (!chatId) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
  }).catch(() => {});
}

/* ────────────────────────── состояние аккаунта ─────────────────────────── */

/** Ошибка публикации ударяет по аккаунту: считаем серию и гасим по типу отказа. */
export async function markAccountFailure(
  admin: SupabaseClient,
  account: PublishAccount,
  kind: "token" | "limit" | "temporary" | "fatal" | "unsupported",
  message: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_error: message.slice(0, 500),
    consecutive_errors: (account.consecutive_errors ?? 0) + 1,
  };
  // Сбой аккаунта и сбой одной публикации — разные вещи. Гасим аккаунт только
  // там, где следующая попытка гарантированно упрётся в то же самое.
  if (kind === "token") patch.status = "token_expired";
  if (kind === "limit") patch.status = "limited";
  await admin.from("publish_accounts").update(patch).eq("id", account.id);
}

export async function markAccountSuccess(
  admin: SupabaseClient,
  accountId: string,
): Promise<void> {
  await admin.from("publish_accounts").update({
    last_post_at: new Date().toISOString(),
    consecutive_errors: 0,
    last_error: null,
  }).eq("id", accountId);
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

/* ────────────────────────── авторизация вызовов ────────────────────────── */

/** Крон и n8n ходят с x-automation-key; ключ — automation_settings.cron_secret. */
export async function automationKeyValid(req: Request, admin: SupabaseClient): Promise<boolean> {
  const key = req.headers.get("x-automation-key");
  if (!key) return false;
  const { data } = await admin
    .from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  const secret = (data as { cron_secret?: string | null } | null)?.cron_secret ?? null;
  return Boolean(secret) && key === secret;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
