/**
 * Радар идей: чистые помощники клиента (формат ER, тон оценки, ник из ссылки).
 */
import { describe, expect, it } from "vitest";
import { formatEngagement, scoreTone, sourceHandleFromUrl } from "@/lib/radarClient";

describe("formatEngagement", () => {
  it("доля → проценты с одним знаком в ru-локали", () => {
    expect(formatEngagement(0.06)).toBe("6,0 %");
    expect(formatEngagement(0.1234)).toBe("12,3 %");
    expect(formatEngagement(0)).toBe("0,0 %");
  });
  it("нет данных → тире", () => {
    expect(formatEngagement(null)).toBe("—");
    expect(formatEngagement(undefined)).toBe("—");
    expect(formatEngagement(Number.NaN)).toBe("—");
  });
});

describe("scoreTone", () => {
  it("пороги: ≥75 hot, ≥55 warm, иначе cold", () => {
    expect(scoreTone(100)).toBe("hot");
    expect(scoreTone(75)).toBe("hot");
    expect(scoreTone(74.9)).toBe("warm");
    expect(scoreTone(55)).toBe("warm");
    expect(scoreTone(54)).toBe("cold");
    expect(scoreTone(0)).toBe("cold");
  });
  it("null/undefined считаются нулём", () => {
    expect(scoreTone(null)).toBe("cold");
    expect(scoreTone(undefined)).toBe("cold");
  });
});

describe("sourceHandleFromUrl", () => {
  it("снимает @ и пробелы", () => {
    expect(sourceHandleFromUrl("@clinic")).toBe("clinic");
    expect(sourceHandleFromUrl("  @@clinic  ")).toBe("clinic");
    expect(sourceHandleFromUrl("clinic")).toBe("clinic");
  });
  it("ссылки Instagram / TikTok / Threads → ник", () => {
    expect(sourceHandleFromUrl("https://www.instagram.com/clinic/")).toBe("clinic");
    expect(sourceHandleFromUrl("http://instagram.com/clinic")).toBe("clinic");
    expect(sourceHandleFromUrl("https://www.tiktok.com/@clinic?lang=ru")).toBe("clinic");
    expect(sourceHandleFromUrl("https://www.threads.net/@clinic")).toBe("clinic");
    expect(sourceHandleFromUrl("https://threads.com/@clinic/")).toBe("clinic");
  });
  it("хвостовые слэши и query у голого ника", () => {
    expect(sourceHandleFromUrl("clinic//")).toBe("clinic");
    expect(sourceHandleFromUrl("https://m.instagram.com/clinic/?hl=ru#x")).toBe("clinic");
  });
  it("пустая строка → пусто", () => {
    expect(sourceHandleFromUrl("")).toBe("");
    expect(sourceHandleFromUrl("   ")).toBe("");
  });
});
