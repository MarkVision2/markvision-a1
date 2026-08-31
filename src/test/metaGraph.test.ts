/**
 * Классификация ошибок Meta и backoff.
 *
 * От этого напрямую зависит, будет ли задание запуска ретраиться вечно
 * (протухший токен ретраем не чинится) или наоборот навсегда упадёт там,
 * где хватило бы повтора через минуту (throttle).
 */
import { describe, expect, it } from "vitest";
import {
  backoffMinutes,
  classifyMetaError,
  describeMetaError,
  type MetaError,
  normalizeAdAccount,
} from "../../supabase/functions/_lib/metaGraph.ts";

function err(over: Partial<MetaError> = {}): MetaError {
  return {
    message: "boom",
    code: null,
    subcode: null,
    type: null,
    traceId: null,
    httpStatus: 400,
    ...over,
  };
}

describe("classifyMetaError", () => {
  it("лимиты вызовов — повторяемые", () => {
    for (const code of [4, 17, 613, 80004]) {
      expect(classifyMetaError(err({ code }))).toBe("retryable");
    }
  });

  it("протухший токен и отказ в правах — фатальные", () => {
    for (const code of [190, 200, 272, 294, 368, 100]) {
      expect(classifyMetaError(err({ code }))).toBe("fatal");
    }
  });

  it("5xx и 429 без кода — повторяемые", () => {
    expect(classifyMetaError(err({ httpStatus: 503 }))).toBe("retryable");
    expect(classifyMetaError(err({ httpStatus: 429 }))).toBe("retryable");
  });

  it("нераспознанная ошибка не выдаёт себя за фатальную", () => {
    expect(classifyMetaError(err({ code: 123456 }))).toBe("unknown");
    expect(classifyMetaError(null)).toBe("unknown");
  });

  it("сетевой сбой (httpStatus 503 из обёртки) повторяется", () => {
    expect(classifyMetaError(err({ type: "network", httpStatus: 503 }))).toBe("retryable");
  });
});

describe("describeMetaError", () => {
  it("для кода 190 объясняет, что делать человеку", () => {
    expect(describeMetaError(err({ code: 190 }))).toContain("переподключите кабинет");
  });

  it("сохраняет исходное сообщение Meta для прочих кодов", () => {
    expect(describeMetaError(err({ code: 999, message: "Что-то не так" }))).toBe("Что-то не так");
  });
});

describe("backoffMinutes", () => {
  it("растёт экспоненциально и упирается в потолок", () => {
    expect(backoffMinutes(0)).toBe(1);
    expect(backoffMinutes(1)).toBe(2);
    expect(backoffMinutes(3)).toBe(8);
    expect(backoffMinutes(10)).toBe(60);
    expect(backoffMinutes(10, 30)).toBe(30);
  });
});

describe("normalizeAdAccount", () => {
  it("приводит любые написания к act_<digits>", () => {
    expect(normalizeAdAccount("123456")).toBe("act_123456");
    expect(normalizeAdAccount("act_123456")).toBe("act_123456");
    expect(normalizeAdAccount("  act_123456 ")).toBe("act_123456");
    expect(normalizeAdAccount("ACT_123456")).toBe("act_123456");
  });

  it("пустой ввод остаётся пустым — вызывающий код обязан это заметить", () => {
    expect(normalizeAdAccount("")).toBe("");
    expect(normalizeAdAccount("act_")).toBe("");
  });
});
