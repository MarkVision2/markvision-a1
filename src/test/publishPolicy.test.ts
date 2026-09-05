/**
 * Политика ошибок и повторов очереди публикаций (_lib/publishPolicy.ts):
 * канонические классы, backoff с джиттером, решение retry/fail/manual_review.
 */
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BLOCKED_DELAY_MIN,
  backoffMinutes,
  classifyError,
  decideRetry,
  ERROR_CLASSES,
  MAX_VERIFY_ATTEMPTS,
  verifyDelayMinutes,
  withJitter,
} from "../../supabase/functions/_lib/publishPolicy.ts";

describe("классификация ошибок", () => {
  it("мёртвый токен → AUTH_EXPIRED, отозванный → AUTH_REVOKED, без токена → RECONNECT_REQUIRED", () => {
    expect(classifyError("token", "190", "Invalid OAuth access token")).toBe("AUTH_EXPIRED");
    expect(classifyError("token", "access_token_invalid", "The access token is revoked")).toBe("AUTH_REVOKED");
    expect(classifyError("token", "no_token", "токен аккаунта не сохранён — нужен reconnect")).toBe("RECONNECT_REQUIRED");
  });

  it("лимит → RATE_LIMIT, временный → PLATFORM_TEMPORARY_ERROR / NETWORK_ERROR / TIMEOUT", () => {
    expect(classifyError("limit", "4", "Application request limit reached")).toBe("RATE_LIMIT");
    expect(classifyError("temporary", "2", "An unexpected error has occurred")).toBe("PLATFORM_TEMPORARY_ERROR");
    expect(classifyError("temporary", "publisher_exception", "fetch failed: ECONNRESET")).toBe("NETWORK_ERROR");
    expect(classifyError("temporary", "processing_timeout", "площадка не обработала")).toBe("TIMEOUT");
  });

  it("отказы по существу раскладываются по медиа / правам / ограничениям", () => {
    expect(classifyError("fatal", "video_size", "файл превышает размер")).toBe("MEDIA_TOO_LARGE");
    expect(classifyError("fatal", "container_error", "Instagram не смог обработать медиа")).toBe("MEDIA_PROCESSING_FAILED");
    expect(classifyError("fatal", "2207026", "Unsupported video format")).toBe("MEDIA_INVALID");
    expect(classifyError("fatal", "10", "(#10) Application does not have permission")).toBe("PLATFORM_PERMISSION_ERROR");
    expect(classifyError("fatal", "spam_risk_too_many_posts", "spam risk")).toBe("ACCOUNT_RESTRICTED");
    expect(classifyError("fatal", "9999", "что-то странное")).toBe("UNKNOWN_ERROR");
  });

  it("unsupported → NOT_IMPLEMENTED, capability_missing → CAPABILITY_MISSING; все классы — из словаря", () => {
    expect(classifyError("unsupported", "not_implemented", "")).toBe("NOT_IMPLEMENTED");
    expect(classifyError("unsupported", "capability_missing", "")).toBe("CAPABILITY_MISSING");
    for (const kind of ["token", "limit", "temporary", "fatal", "unsupported"] as const) {
      expect(ERROR_CLASSES).toContain(classifyError(kind, "x", "y"));
    }
  });
});

describe("backoff и джиттер", () => {
  it("экспонента 1 → 2 → 4 → 8 → 16 → 30 с потолком", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((a) => backoffMinutes(a))).toEqual([1, 2, 4, 8, 16, 30, 30]);
  });

  it("джиттер держится в ±20 % и не опускается ниже минуты", () => {
    expect(withJitter(10, 0)).toBe(8);
    expect(withJitter(10, 1)).toBe(12);
    expect(withJitter(10, 0.5)).toBe(10);
    expect(withJitter(1, 0)).toBe(1);
  });
});

describe("решение по повтору", () => {
  it("unsupported — сразу на ручной разбор, попытки не жгутся", () => {
    expect(decideRetry({ kind: "unsupported", attempts: 1, maxAttempts: 5 }).action).toBe("manual_review");
  });

  it("токен/лимит — час ожидания, после maxAttempts — человек", () => {
    const d = decideRetry({ kind: "token", attempts: 1, maxAttempts: 5, random: 0.5 });
    expect(d.action).toBe("retry");
    expect(d.delayMinutes).toBe(ACCOUNT_BLOCKED_DELAY_MIN);
    expect(decideRetry({ kind: "limit", attempts: 5, maxAttempts: 5 }).action).toBe("manual_review");
  });

  it("временный сбой — backoff, после maxAttempts — отказ", () => {
    expect(decideRetry({ kind: "temporary", attempts: 3, maxAttempts: 5, random: 0.5 })).toMatchObject({ action: "retry", delayMinutes: 4 });
    expect(decideRetry({ kind: "temporary", attempts: 5, maxAttempts: 5 }).action).toBe("fail");
  });

  it("fatal — отказ сразу, независимо от попыток", () => {
    expect(decideRetry({ kind: "fatal", attempts: 1, maxAttempts: 5 }).action).toBe("fail");
  });
});

describe("верификация", () => {
  it("лестница пауз растёт и не выходит за последнюю ступень", () => {
    expect([0, 1, 2, 3, 4, 9].map(verifyDelayMinutes)).toEqual([1.5, 3, 6, 12, 20, 20]);
    expect(MAX_VERIFY_ATTEMPTS).toBe(5);
  });
});
