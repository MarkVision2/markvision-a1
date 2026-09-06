/**
 * Исходящие вебхуки — чистая часть: подпись доставки и пауза перед повтором.
 * Без Deno и Supabase, покрыта vitest (src/test/webhooks.test.ts).
 *
 * Подпись: HMAC-SHA256(secret, `${timestamp}.${body}`), заголовок
 *   X-MarkVision-Signature: t=<unix>,v1=<hex>
 * Получатель проверяет так же и отбрасывает старые timestamp (рекомендуем 5 минут).
 */

export const WEBHOOK_EVENTS = [
  "publication.published", "publication.failed", "publication.needs_human", "publication.unverified",
  "account.reconnect_required", "campaign.completed", "report.daily",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(v: unknown): v is WebhookEvent | "*" {
  return v === "*" || (typeof v === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(v));
}

/** Пауза перед повтором доставки, минуты: 1 → 5 → 15 → 60 → 180. */
export const WEBHOOK_RETRY_LADDER_MIN = [1, 5, 15, 60, 180];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_LADDER_MIN.length;

export function webhookRetryDelayMinutes(attempts: number): number {
  return WEBHOOK_RETRY_LADDER_MIN[Math.min(Math.max(attempts - 1, 0), WEBHOOK_RETRY_LADDER_MIN.length - 1)];
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signWebhook(secret: string, body: string, timestampSec: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestampSec}.${body}`));
  return `t=${timestampSec},v1=${hex(mac)}`;
}

/** Проверка подписи на стороне получателя (и в тестах): допуск по времени в секундах. */
export async function verifyWebhookSignature(
  secret: string, body: string, header: string, nowSec: number, toleranceSec = 300,
): Promise<boolean> {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = await signWebhook(secret, body, ts);
  return expected === `t=${ts},v1=${m[2]}`;
}

/** Случайный секрет вебхука (показывается один раз, в базе — шифротекст). */
export function generateWebhookSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return `whsec_${hex(buf.buffer)}`;
}

/** Ответ 2xx — доставлено; 4xx кроме 408/425/429 — не повторяем (адрес не примет); остальное — повтор. */
export function classifyDeliveryStatus(status: number): "delivered" | "retry" | "failed" {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 408 || status === 425 || status === 429 || status >= 500 || status === 0) return "retry";
  return "failed";
}
