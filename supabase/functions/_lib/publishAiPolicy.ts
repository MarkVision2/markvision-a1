/**
 * Политика AI проекта — чистый модуль (без Deno и Supabase), покрыт vitest
 * (src/test/publishAiPolicy.test.ts).
 *
 * Публикации, поставленные через публичный API / MCP (то есть AI-агентом или
 * внешней автоматикой), проходят ворота согласования по политике проекта:
 *
 *   manual    — всё ждёт человека (status = manual_review, error_code = awaiting_approval);
 *   assisted  — первые ai_daily_limit заданий за сутки уходят сами, остальное ждёт;
 *   automatic — ворот нет.
 *
 * Согласование — jobs_approve / jobs_reject в publish-accounts (человек в
 * интерфейсе, Telegram или n8n через API); через MCP согласовать нельзя.
 */

export type AiPolicy = "manual" | "assisted" | "automatic";
export const AI_POLICIES: AiPolicy[] = ["manual", "assisted", "automatic"];
export const DEFAULT_AI_POLICY: AiPolicy = "manual";
export const DEFAULT_AI_DAILY_LIMIT = 10;

/** Маркер задания на согласовании (publish_jobs.error_code при status = manual_review). */
export const AWAITING_APPROVAL_CODE = "awaiting_approval";

export function isAiPolicy(v: unknown): v is AiPolicy {
  return typeof v === "string" && (AI_POLICIES as string[]).includes(v);
}

export const AI_POLICY_LABELS: Record<AiPolicy, { label: string; hint: string }> = {
  manual: { label: "Ручная", hint: "Каждая публикация от AI / API ждёт согласования человека." },
  assisted: { label: "С помощником", hint: "Первые N публикаций в сутки уходят сами, остальные — на согласование." },
  automatic: { label: "Автоматическая", hint: "Публикации от AI / API уходят без ворот — как из интерфейса." },
};

export interface PolicyDecision {
  /** Сколько из новых заданий уходят автоматически (первые по порядку). */
  auto: number;
  /** Сколько остаются на согласовании. */
  hold: number;
  /** Причина удержания — в error_message задания и уведомление; null, если ничего не удержано. */
  reason: string | null;
}

/**
 * Решение по пачке новых заданий: autoToday — сколько за сутки уже ушло
 * автоматически через API (без этой пачки), dailyLimit — предел assisted.
 */
export function policyDecision(
  policy: AiPolicy,
  opts: { incoming: number; autoToday: number; dailyLimit: number },
): PolicyDecision {
  const incoming = Math.max(0, Math.floor(opts.incoming));
  if (incoming === 0) return { auto: 0, hold: 0, reason: null };
  if (policy === "automatic") return { auto: incoming, hold: 0, reason: null };
  if (policy === "manual") {
    return { auto: 0, hold: incoming, reason: "Ожидает согласования: политика AI проекта — ручная" };
  }
  const limit = Math.max(0, Math.floor(opts.dailyLimit));
  const room = Math.max(0, limit - Math.max(0, Math.floor(opts.autoToday)));
  const auto = Math.min(incoming, room);
  const hold = incoming - auto;
  return {
    auto,
    hold,
    reason: hold > 0 ? `Ожидает согласования: суточный лимит AI-публикаций (${limit}) исчерпан` : null,
  };
}

/** Начало текущих суток по UTC — по нему считается «сегодня» суточного лимита. */
export function utcDayStart(now: Date | number = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
