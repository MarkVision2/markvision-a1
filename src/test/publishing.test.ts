/**
 * Контур автопубликации: чистая логика из supabase/functions/_lib.
 * Проверяем то, что ломается тихо — шифрование токенов и раскладку заданий
 * по времени: ошибка здесь не падает, а просто публикует не туда и не тогда.
 */
import { beforeAll, describe, expect, it } from "vitest";

type DenoStub = { env: { get(key: string): string | undefined } };

beforeAll(() => {
  // Модули читают ключ через globalThis.Deno — вне Deno подставляем заглушку.
  (globalThis as { Deno?: DenoStub }).Deno = {
    env: { get: (key: string) => (key === "PUBLISH_TOKEN_KEY" ? "тестовый ключ шифрования" : undefined) },
  };
});

describe("шифрование токенов площадок", () => {
  it("шифрует и расшифровывает обратно", async () => {
    const { encryptSecret, decryptSecret } = await import("../../supabase/functions/_lib/publishCore.ts");
    const token = "EAAG_page_token_1234567890";
    const stored = await encryptSecret(token);

    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(token);
    expect(await decryptSecret(stored)).toBe(token);
  });

  it("даёт разный шифротекст при каждом вызове (свежий iv)", async () => {
    const { encryptSecret } = await import("../../supabase/functions/_lib/publishCore.ts");
    const a = await encryptSecret("одно и то же");
    const b = await encryptSecret("одно и то же");
    expect(a).not.toBe(b);
  });

  it("читает legacy-токен без префикса как открытый текст", async () => {
    const { decryptSecret } = await import("../../supabase/functions/_lib/publishCore.ts");
    expect(await decryptSecret("EAAplain")).toBe("EAAplain");
    expect(await decryptSecret(null)).toBeNull();
  });
});

describe("подпись поста", () => {
  it("склеивает текст и хэштеги, добавляя решётку", async () => {
    const { composeCaption } = await import("../../supabase/functions/_lib/publishCore.ts");
    expect(composeCaption("Текст", ["клиника", "#импланты"])).toBe("Текст\n\n#клиника #импланты");
  });

  it("не оставляет пустых строк, когда чего-то нет", async () => {
    const { composeCaption } = await import("../../supabase/functions/_lib/publishCore.ts");
    expect(composeCaption(null, ["тег"])).toBe("#тег");
    expect(composeCaption("  Текст  ", [])).toBe("Текст");
    expect(composeCaption(null, [])).toBe("");
  });
});

describe("раскладка заданий по времени", () => {
  const start = new Date("2026-09-01T10:00:00.000Z");

  it("drip разносит аккаунты равными промежутками", async () => {
    const { scheduleFor } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    const target = { mode: "drip" as const, per_hour: 10, start_at: start.toISOString() };
    expect(scheduleFor(target, 0)).toBe("2026-09-01T10:00:00.000Z");
    expect(scheduleFor(target, 1)).toBe("2026-09-01T10:06:00.000Z");
    expect(scheduleFor(target, 9)).toBe("2026-09-01T10:54:00.000Z");
  });

  it("сотый аккаунт при 10 в час уезжает на 10 часов, а не в ту же минуту", async () => {
    const { scheduleFor } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    const at = new Date(scheduleFor({ mode: "drip", per_hour: 10, start_at: start.toISOString() }, 99));
    expect((at.getTime() - start.getTime()) / 3_600_000).toBeCloseTo(9.9, 5);
  });

  it("per_hour зажимается в допустимые границы", async () => {
    const { scheduleFor } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    // 0 в час не должен давать деление на ноль или мгновенную публикацию всех.
    const slow = scheduleFor({ mode: "drip", per_hour: 0, start_at: start.toISOString() }, 1);
    expect(new Date(slow).getTime() - start.getTime()).toBe(3_600_000);
    const fast = scheduleFor({ mode: "drip", per_hour: 9999, start_at: start.toISOString() }, 1);
    expect(new Date(fast).getTime() - start.getTime()).toBe(30_000);
  });

  it("now кладёт всех на одно время, daily — по одному в сутки", async () => {
    const { scheduleFor } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    expect(scheduleFor({ mode: "now", start_at: start.toISOString() }, 5)).toBe(start.toISOString());
    expect(scheduleFor({ mode: "daily", start_at: start.toISOString() }, 3)).toBe("2026-09-04T10:00:00.000Z");
  });

  it("без start_at считает от переданного «сейчас»", async () => {
    const { scheduleFor } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    expect(scheduleFor({ mode: "now" }, 0, start)).toBe(start.toISOString());
  });
});

describe("варианты подписи по аккаунтам", () => {
  it("раздаёт варианты по кругу", async () => {
    const { pickCaption } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    const variants = ["первый", "второй"];
    expect(pickCaption(variants, "база", 0)).toBe("первый");
    expect(pickCaption(variants, "база", 1)).toBe("второй");
    expect(pickCaption(variants, "база", 2)).toBe("первый");
  });

  it("без вариантов отдаёт базовый текст", async () => {
    const { pickCaption } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    expect(pickCaption([], "база", 0)).toBe("база");
    expect(pickCaption(null, "база", 3)).toBe("база");
  });
});

describe("проверка ссылки на видео", () => {
  it("пропускает https-ссылку на mp4", async () => {
    const { validateVideoRef } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    expect(validateVideoRef("https://cdn.example.com/a.mp4", 30).ok).toBe(true);
    expect(validateVideoRef("https://cdn.example.com/a.mp4?token=x", null).ok).toBe(true);
  });

  it("отклоняет http, чужой формат и длительность вне границ", async () => {
    const { validateVideoRef } = await import("../../supabase/functions/_lib/publishSchedule.ts");
    expect(validateVideoRef("http://cdn.example.com/a.mp4", 30).ok).toBe(false);
    expect(validateVideoRef("https://cdn.example.com/a.jpg", 30).ok).toBe(false);
    expect(validateVideoRef("https://cdn.example.com/a.mp4", 1).ok).toBe(false);
    expect(validateVideoRef("https://cdn.example.com/a.mp4", 16 * 60).ok).toBe(false);
  });
});
