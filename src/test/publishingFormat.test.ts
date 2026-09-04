/**
 * Формат времени в «Публикациях»: относительные подписи в обе стороны
 * и русские окончания — «1 час назад», но «5 часов назад».
 */
import { describe, it, expect } from "vitest";
import { fmtExact, fmtNum, fmtRelative } from "@/lib/publishingFormat";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("fmtRelative", () => {
  it("пустое значение и мусор дают прочерк", () => {
    expect(fmtRelative(null, NOW)).toBe("—");
    expect(fmtRelative("не дата", NOW)).toBe("—");
  });

  it("минуты в обе стороны", () => {
    expect(fmtRelative(at(-30_000), NOW)).toBe("только что");
    expect(fmtRelative(at(30_000), NOW)).toBe("вот-вот");
    expect(fmtRelative(at(-12 * MIN), NOW)).toBe("12 мин назад");
    expect(fmtRelative(at(12 * MIN), NOW)).toBe("через 12 мин");
  });

  it("часы склоняются по-русски", () => {
    expect(fmtRelative(at(-1 * HOUR), NOW)).toBe("1 час назад");
    expect(fmtRelative(at(-3 * HOUR), NOW)).toBe("3 часа назад");
    expect(fmtRelative(at(-5 * HOUR), NOW)).toBe("5 часов назад");
    expect(fmtRelative(at(2 * HOUR), NOW)).toBe("через 2 часа");
    // 59,6 минут — уже «1 час», а не «60 мин».
    expect(fmtRelative(at(59.6 * MIN), NOW)).toBe("через 1 час");
  });

  it("сутки — словами", () => {
    expect(fmtRelative(at(-1 * DAY), NOW)).toBe("вчера");
    expect(fmtRelative(at(1 * DAY), NOW)).toBe("завтра");
    expect(fmtRelative(at(-3 * DAY), NOW)).toBe("3 дн. назад");
    expect(fmtRelative(at(5 * DAY), NOW)).toBe("через 5 дн.");
  });

  it("дальше месяца — обычная дата: «412 дн. назад» ни о чём не говорит", () => {
    expect(fmtRelative(at(-60 * DAY), NOW)).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
  });
});

describe("fmtExact", () => {
  it("даёт точное время для подсказки", () => {
    expect(fmtExact("2026-09-04T18:27:09Z")).toMatch(/04\.09\.2026/);
    expect(fmtExact(null)).toBe("—");
  });
});

describe("fmtNum", () => {
  it("разделяет разряды, null — прочерк", () => {
    expect(fmtNum(312000).replace(/\D/g, "")).toBe("312000");
    expect(fmtNum(null)).toBe("—");
  });
});
