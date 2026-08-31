import { describe, expect, it } from "vitest";
import {
  isTransientMetaError,
  MetaApiError,
} from "../../supabase/functions/_lib/metaGraph.ts";

describe("классификация ошибок Meta", () => {
  it("лимиты запросов — временные, повтор осмыслен", () => {
    for (const code of [4, 17, 32, 613, 80004]) {
      expect(isTransientMetaError(400, { code })).toBe(true);
    }
  });

  it("внутренние сбои Meta — временные", () => {
    expect(isTransientMetaError(400, { code: 1 })).toBe(true);
    expect(isTransientMetaError(400, { code: 2 })).toBe(true);
    expect(isTransientMetaError(400, { is_transient: true, code: 100 })).toBe(true);
  });

  it("протухший токен и отклонённая настройка — окончательные", () => {
    expect(isTransientMetaError(400, { code: 190 })).toBe(false);
    expect(isTransientMetaError(400, { code: 100 })).toBe(false);
    // #1487246 — номер WhatsApp не привязан к аккаунту: повтор не поможет.
    expect(isTransientMetaError(400, { code: 1487246 })).toBe(false);
  });

  it("без кода Meta смотрим на HTTP-статус", () => {
    expect(isTransientMetaError(429, null)).toBe(true);
    expect(isTransientMetaError(503, null)).toBe(true);
    expect(isTransientMetaError(400, null)).toBe(false);
  });
});

describe("MetaApiError", () => {
  it("показывает пользовательское сообщение Meta, если оно есть", () => {
    const err = new MetaApiError(400, {
      code: 1487246,
      message: "Invalid parameter",
      error_user_msg: "Этот номер WhatsApp не привязан к аккаунту",
    }, "fallback");
    expect(err.message).toBe("Этот номер WhatsApp не привязан к аккаунту");
    expect(err.code).toBe(1487246);
    expect(err.transient).toBe(false);
  });

  it("падает на техническое сообщение, когда пользовательского нет", () => {
    const err = new MetaApiError(500, { code: 2, message: "Service temporarily unavailable" }, "fb");
    expect(err.message).toBe("Service temporarily unavailable");
    expect(err.transient).toBe(true);
  });

  it("без тела ошибки использует запасной текст", () => {
    const err = new MetaApiError(502, null, "Meta POST ads → HTTP 502");
    expect(err.message).toBe("Meta POST ads → HTTP 502");
    expect(err.transient).toBe(true);
  });
});
