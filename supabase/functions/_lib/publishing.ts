/**
 * Общая часть контура автопубликации (docs/PUBLISHING-SYSTEM.md).
 *
 * Здесь всё, что требует Supabase: строки таблиц, журнал ответов площадок,
 * статусы аккаунтов, уведомления в Telegram проекта и авторизация вызовов.
 * Шифрование токенов и склейка подписи — в publishCore.ts (чистый модуль).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

// Чистая часть живёт отдельным модулем; здесь пере-экспорт, чтобы вызывающим
// не пришлось помнить, что где лежит.
export {
  composeCaption,
  decryptSecret,
  encryptSecret,
  isPlatform,
  PLATFORMS,
  tokenKeyConfigured,
} from "./publishCore.ts";
export type { Platform, PublishAccount } from "./publishCore.ts";

import type { Platform, PublishAccount } from "./publishCore.ts";

/* ────────────────────────────── строки таблиц ──────────────────────────── */

export type NotifyMode = "digest" | "each" | "silent";

/** Режим уведомлений проекта: digest (по умолчанию) — сбои копятся в часовой дайджест. */
export async function notifyModeOf(admin: SupabaseClient, projectId: string): Promise<NotifyMode> {
  const { data } = await admin
    .from("publish_project_settings").select("notify_mode").eq("project_id", projectId).maybeSingle();
  const mode = (data as { notify_mode?: string } | null)?.notify_mode;
  return mode === "each" || mode === "silent" ? mode : "digest";
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
  /** Опросов обработки медиа (processing) — не смешивается с attempts. */
  poll_count?: number;
  status?: string;
  locked_at?: string | null;
  /** Ядро Phase 1 (миграция 20260908100000): верификация и трасса. */
  external_post_id?: string | null;
  external_post_url?: string | null;
  verification_status?: "pending" | "verified" | "unverified" | "skipped";
  verify_attempts?: number;
  trace_id?: string | null;
  error_class?: string | null;
}

export interface PublishVideo {
  id: string;
  project_id: string;
  status: string;
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
  chatIdOverride?: string | null,
): Promise<void> {
  const botToken = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!botToken) return;
  let chatId = chatIdOverride?.trim() || null;
  if (!chatId) {
    const { data } = await admin
      .from("telegram_links").select("chat_id").eq("project_id", projectId).limit(1).maybeSingle();
    chatId = (data as { chat_id?: string } | null)?.chat_id ?? null;
  }
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
