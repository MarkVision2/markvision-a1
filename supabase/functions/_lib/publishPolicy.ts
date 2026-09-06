/**
 * Политика ошибок и повторов очереди публикаций — чистый модуль (без Deno и
 * Supabase), покрыт vitest (src/test/publishPolicy.test.ts).
 *
 * Две вещи, которые раньше были размазаны по publishRunner.ts и публикаторам:
 *
 *  1. Канонический класс ошибки. Площадки отдают свои коды (Meta 190, TikTok
 *     spam_risk_too_many_posts, Google quotaExceeded…), интерфейсу и AI нужен
 *     один словарь: AUTH_EXPIRED, RATE_LIMIT, MEDIA_INVALID… Сырой код остаётся
 *     в publish_jobs.error_code, класс — в publish_jobs.error_class.
 *
 *  2. Решение по повтору: повторять ли, через сколько, или отдать человеку.
 *     Экспоненциальный backoff с джиттером, чтобы 100 аккаунтов, упавших на
 *     одном сбое площадки, не вернулись в очередь одной пачкой.
 */
import type { FailureKind } from "./publishers/types.ts";

export type ErrorClass =
  | "AUTH_EXPIRED"
  | "AUTH_REVOKED"
  | "RECONNECT_REQUIRED"
  | "MEDIA_INVALID"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_PROCESSING_FAILED"
  | "RATE_LIMIT"
  | "PLATFORM_TEMPORARY_ERROR"
  | "PLATFORM_PERMISSION_ERROR"
  | "ACCOUNT_RESTRICTED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "CAPABILITY_MISSING"
  | "NOT_IMPLEMENTED"
  | "UNKNOWN_ERROR";

export const ERROR_CLASSES: ErrorClass[] = [
  "AUTH_EXPIRED", "AUTH_REVOKED", "RECONNECT_REQUIRED",
  "MEDIA_INVALID", "MEDIA_TOO_LARGE", "MEDIA_PROCESSING_FAILED",
  "RATE_LIMIT", "PLATFORM_TEMPORARY_ERROR", "PLATFORM_PERMISSION_ERROR", "ACCOUNT_RESTRICTED",
  "NETWORK_ERROR", "TIMEOUT", "CAPABILITY_MISSING", "NOT_IMPLEMENTED", "UNKNOWN_ERROR",
];

/**
 * Класс ошибки по типу отказа публикатора, сырому коду площадки и тексту.
 * Тип отказа (kind) — главный сигнал: его уже выставил публикатор, зная свою
 * площадку. Код и текст уточняют класс внутри типа.
 */
export function classifyError(kind: FailureKind, code: string | null | undefined, message: string | null | undefined): ErrorClass {
  const c = String(code ?? "").toLowerCase();
  const m = String(message ?? "").toLowerCase();
  switch (kind) {
    case "token":
      if (/revoked|отозван|deauthoriz|password.*changed|access_token_invalid|invalid_grant/.test(`${c} ${m}`)) return "AUTH_REVOKED";
      if (/reconnect|нужен reconnect|no_token|token_unreadable/.test(`${c} ${m}`)) return "RECONNECT_REQUIRED";
      return "AUTH_EXPIRED";
    case "limit":
      return "RATE_LIMIT";
    case "temporary":
      if (/timeout|timed out|deadline|processing_timeout/.test(`${c} ${m}`)) return "TIMEOUT";
      if (/network|fetch failed|econn|socket|dns|сеть|source_unavailable/.test(`${c} ${m}`)) return "NETWORK_ERROR";
      return "PLATFORM_TEMPORARY_ERROR";
    case "unsupported":
      return c === "capability_missing" ? "CAPABILITY_MISSING" : "NOT_IMPLEMENTED";
    case "fatal":
      if (/too_large|too large|video_size|file size|exceeds|превышает размер/.test(`${c} ${m}`)) return "MEDIA_TOO_LARGE";
      if (/container_error|processing_timeout|не смог обработать|processing failed|transcod/.test(`${c} ${m}`)) return "MEDIA_PROCESSING_FAILED";
      if (/format|codec|duration|aspect|resolution|frame rate|bitrate|unsupported media|invalid_file|url_ownership|media type|длительност|формат/.test(`${c} ${m}`)) return "MEDIA_INVALID";
      if (/permission|scope|not authorized|unauthorized_scope|insufficient|#10\b|\(#10\)|\(#200\)|нет прав/.test(`${c} ${m}`)) return "PLATFORM_PERMISSION_ERROR";
      if (/restricted|blocked|suspended|disabled|spam|policy|community|ограничен|заблокирован/.test(`${c} ${m}`)) return "ACCOUNT_RESTRICTED";
      return "UNKNOWN_ERROR";
  }
  return "UNKNOWN_ERROR";
}

/* ─────────────────────────────── повторы ──────────────────────────────── */

export type RetryAction =
  /** Вернуть в очередь через delayMinutes. */
  | "retry"
  /** Окончательный отказ задания. */
  | "fail"
  /** Отдать человеку (аккаунт не починен за все попытки / площадка не подключена). */
  | "manual_review";

export interface RetryDecision {
  action: RetryAction;
  /** Пауза до следующей попытки в минутах (только для retry). */
  delayMinutes: number;
  /** Почему так — коротко, для журнала. */
  reason: string;
}

export interface RetryPolicyInput {
  kind: FailureKind;
  /** Попыток уже сделано (после инкремента claim). */
  attempts: number;
  maxAttempts: number;
  /** 0..1 — случайная величина для джиттера; по умолчанию Math.random(). */
  random?: number;
}

/** Потолок экспоненциального backoff для временных сбоев. */
export const TEMPORARY_BACKOFF_CAP_MIN = 30;
/** Пауза, пока аккаунт ждёт reconnect / снятия лимита. */
export const ACCOUNT_BLOCKED_DELAY_MIN = 60;
/** Джиттер: ±20 % от паузы. */
export const JITTER_SHARE = 0.2;

/** Экспоненциальная пауза 1 → 2 → 4 → … с потолком (без джиттера). */
export function backoffMinutes(attempts: number, cap = TEMPORARY_BACKOFF_CAP_MIN): number {
  return Math.min(2 ** Math.max(attempts - 1, 0), cap);
}

/** Пауза с джиттером ±20 %: 100 заданий одного сбоя возвращаются в очередь россыпью. */
export function withJitter(minutes: number, random = Math.random()): number {
  const r = Math.min(Math.max(random, 0), 1);
  const factor = 1 - JITTER_SHARE + 2 * JITTER_SHARE * r;
  return Math.max(1, Math.round(minutes * factor * 100) / 100);
}

/**
 * Что делать с отказом. Правила те же, что жили в publishRunner.ts:
 *  - unsupported → ручной разбор сразу (площадка не подключена — попытки не жгут);
 *  - token / limit → беда аккаунта, а не задания: ждём час, после maxAttempts —
 *    ручной разбор (аккаунт так и не починили), а не вечный retry;
 *  - temporary → экспоненциальный backoff с джиттером, после maxAttempts — отказ;
 *  - fatal → отказ сразу: повтор упрётся в то же самое (формат, политика).
 */
export function decideRetry(input: RetryPolicyInput): RetryDecision {
  const { kind, attempts, maxAttempts } = input;
  const random = input.random ?? Math.random();
  if (kind === "unsupported") return { action: "manual_review", delayMinutes: 0, reason: "площадка/возможность не поддерживается" };
  if (kind === "token" || kind === "limit") {
    if (attempts >= maxAttempts) return { action: "manual_review", delayMinutes: 0, reason: `аккаунт не восстановлен за ${maxAttempts} попыток` };
    return { action: "retry", delayMinutes: withJitter(ACCOUNT_BLOCKED_DELAY_MIN, random), reason: kind === "token" ? "ждём reconnect аккаунта" : "ждём снятия лимита площадки" };
  }
  if (kind === "temporary") {
    if (attempts >= maxAttempts) return { action: "fail", delayMinutes: 0, reason: `временный сбой не прошёл за ${maxAttempts} попыток` };
    return { action: "retry", delayMinutes: withJitter(backoffMinutes(attempts), random), reason: "временный сбой площадки/сети" };
  }
  return { action: "fail", delayMinutes: 0, reason: "отказ площадки по существу — повтор бессмыслен" };
}

/* ─────────────────────────── верификация ─────────────────────────────── */

/** Сколько раз читаем пост у площадки после публикации, прежде чем признать unverified. */
export const MAX_VERIFY_ATTEMPTS = 5;

/** Пауза перед следующей проверкой: 1.5 → 3 → 6 → 12 → 20 минут. */
export function verifyDelayMinutes(verifyAttempts: number): number {
  const ladder = [1.5, 3, 6, 12, 20];
  return ladder[Math.min(Math.max(verifyAttempts, 0), ladder.length - 1)];
}
