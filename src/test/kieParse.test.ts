/**
 * Разбор ответов kie.ai.
 *
 * Проверить контракт живым запросом из этой среды нельзя — домен закрыт
 * сетевой политикой, — поэтому формат взят из документации, а разбор сделан
 * терпимым. Тесты фиксируют оба правдоподобных места результата: промах
 * означал бы «задача выполнена, кредиты списаны, а картинки нет».
 */
import { describe, expect, it } from "vitest";
import {
  classifyKieError,
  isPending,
  kieCode,
  kieMessage,
  normalizeState,
  parseTaskStatus,
  resultUrlsOf,
  taskIdOf,
  toKieImageSize,
} from "../../supabase/functions/_lib/kieParse.ts";

describe("taskIdOf", () => {
  it("берёт taskId из data — как в документации", () => {
    expect(taskIdOf({ code: 200, msg: "success", data: { taskId: "task_1" } })).toBe("task_1");
  });

  it("понимает snake_case и корневой уровень", () => {
    expect(taskIdOf({ data: { task_id: "task_2" } })).toBe("task_2");
    expect(taskIdOf({ taskId: "task_3" })).toBe("task_3");
  });

  it("без задачи возвращает null, а не пустую строку", () => {
    expect(taskIdOf({ code: 400, msg: "bad request" })).toBeNull();
    expect(taskIdOf(null)).toBeNull();
  });
});

describe("resultUrlsOf", () => {
  it("достаёт ссылки из resultJson — строки с JSON внутри", () => {
    const urls = resultUrlsOf({
      resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie/a.png", "https://cdn.kie/b.png"] }),
    });
    expect(urls).toEqual(["https://cdn.kie/a.png", "https://cdn.kie/b.png"]);
  });

  it("работает и когда resultJson уже разобран в объект", () => {
    expect(resultUrlsOf({ resultJson: { resultUrls: ["https://cdn.kie/a.png"] } }))
      .toEqual(["https://cdn.kie/a.png"]);
  });

  it("понимает массив объектов с url", () => {
    expect(resultUrlsOf({ resultJson: { resultUrls: [{ url: "https://cdn.kie/a.png" }] } }))
      .toEqual(["https://cdn.kie/a.png"]);
  });

  it("битый resultJson не роняет разбор", () => {
    expect(resultUrlsOf({ resultJson: "{не json" })).toEqual([]);
    expect(resultUrlsOf(null)).toEqual([]);
  });

  it("отбрасывает то, что не похоже на ссылку", () => {
    expect(resultUrlsOf({ resultJson: { resultUrls: ["не ссылка", ""] } })).toEqual([]);
  });
});

describe("normalizeState / isPending", () => {
  it("сводит написания к известным состояниям", () => {
    expect(normalizeState("SUCCESS")).toBe("success");
    expect(normalizeState("completed")).toBe("success");
    expect(normalizeState("failed")).toBe("fail");
    expect(normalizeState("queuing")).toBe("queuing");
    expect(normalizeState("generating")).toBe("generating");
    expect(normalizeState(undefined)).toBe("unknown");
  });

  it("незавершённые состояния распознаются как ожидание", () => {
    expect(isPending("queuing")).toBe(true);
    expect(isPending("generating")).toBe(true);
    expect(isPending("success")).toBe(false);
    expect(isPending("fail")).toBe(false);
  });
});

describe("parseTaskStatus", () => {
  it("успех отдаёт ссылки", () => {
    const s = parseTaskStatus({
      data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie/a.png"] }) },
    });
    expect(s.state).toBe("success");
    expect(s.urls).toEqual(["https://cdn.kie/a.png"]);
  });

  it("ошибка отдаёт текст от сервиса", () => {
    const s = parseTaskStatus({ data: { state: "fail", failMsg: "content policy" } });
    expect(s.state).toBe("fail");
    expect(s.error).toBe("content policy");
  });

  it("ожидание отдаёт прогресс", () => {
    const s = parseTaskStatus({ data: { state: "generating", progress: 0.4 } });
    expect(isPending(s.state)).toBe(true);
    expect(s.progress).toBe(0.4);
  });

  it("результат без state всё равно считается успехом", () => {
    const s = parseTaskStatus({ data: { resultJson: { resultUrls: ["https://cdn.kie/a.png"] } } });
    expect(s.state).toBe("success");
  });
});

describe("classifyKieError", () => {
  it("неверный ключ — фатально", () => {
    const v = classifyKieError(401, { code: 401, msg: "unauthorized" }, "");
    expect(v.retryable).toBe(false);
    expect(v.message).toContain("не принял ключ");
  });

  it("кончились кредиты — фатально и с понятным текстом", () => {
    const v = classifyKieError(402, { code: 402, msg: "insufficient credits" }, "");
    expect(v.retryable).toBe(false);
    expect(v.message).toContain("кредитов");
  });

  it("лимит частоты и сбой сервиса — повторяемо", () => {
    expect(classifyKieError(429, { code: 429 }, "").retryable).toBe(true);
    expect(classifyKieError(503, { code: 503 }, "").retryable).toBe(true);
  });

  it("битый запрос повторять бессмысленно", () => {
    expect(classifyKieError(400, { code: 400, msg: "bad model" }, "").retryable).toBe(false);
  });
});

describe("kieCode / kieMessage", () => {
  it("читают код и сообщение в разных написаниях", () => {
    expect(kieCode({ code: 200 })).toBe(200);
    expect(kieCode({ code: "404" })).toBe(404);
    expect(kieCode({})).toBeNull();
    expect(kieMessage({ msg: "ok" })).toBe("ok");
    expect(kieMessage({ message: "hi" })).toBe("hi");
    expect(kieMessage(null)).toBe("");
  });
});

describe("toKieImageSize", () => {
  it("пропускает готовое соотношение", () => {
    expect(toKieImageSize("4:5")).toBe("4:5");
  });

  it("сокращает размеры в пикселях до соотношения", () => {
    expect(toKieImageSize("1080x1350")).toBe("4:5");
    expect(toKieImageSize("1080×1920")).toBe("9:16");
  });

  it("непонятное значение даёт квадрат, а не поломанный запрос", () => {
    expect(toKieImageSize("")).toBe("1:1");
    expect(toKieImageSize("что-то")).toBe("1:1");
    expect(toKieImageSize(null)).toBe("1:1");
  });
});
