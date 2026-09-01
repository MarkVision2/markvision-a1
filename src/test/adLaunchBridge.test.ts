/**
 * Мост «Контент-завод → реклама»: ссылка на креатив едет через query-параметр.
 * Параметр приходит из адресной строки, поэтому проверяем и то, что чужие
 * схемы (javascript:, data:) до fetch и до Meta не доезжают.
 */
import { describe, expect, it } from "vitest";
import {
  buildAdsLaunchUrl,
  CREATIVE_PARAM,
  fileNameFromUrl,
  parseCreativeParam,
} from "@/lib/adLaunchBridge";

describe("buildAdsLaunchUrl", () => {
  it("открывает вкладку кампаний с креативом", () => {
    const url = new URL(buildAdsLaunchUrl("https://cdn.example/x.jpg"), "https://app.local");
    expect(url.pathname).toBe("/ads");
    expect(url.searchParams.get("tab")).toBe("campaigns");
    expect(url.searchParams.get(CREATIVE_PARAM)).toBe("https://cdn.example/x.jpg");
  });

  it("без ссылки просто открывает вкладку", () => {
    const url = new URL(buildAdsLaunchUrl("  "), "https://app.local");
    expect(url.searchParams.has(CREATIVE_PARAM)).toBe(false);
  });
});

describe("parseCreativeParam", () => {
  it("пропускает http и https", () => {
    expect(parseCreativeParam("https://cdn.example/x.jpg")).toBe("https://cdn.example/x.jpg");
    expect(parseCreativeParam("http://cdn.example/x.jpg")).toBe("http://cdn.example/x.jpg");
  });

  it("отбрасывает опасные и битые схемы", () => {
    expect(parseCreativeParam("javascript:alert(1)")).toBeNull();
    expect(parseCreativeParam("data:image/png;base64,AAAA")).toBeNull();
    expect(parseCreativeParam("не ссылка")).toBeNull();
    expect(parseCreativeParam(null)).toBeNull();
    expect(parseCreativeParam("")).toBeNull();
  });
});

describe("fileNameFromUrl", () => {
  it("берёт имя файла из пути", () => {
    expect(fileNameFromUrl("https://cdn.example/a/b/banner.png")).toBe("banner.png");
  });

  it("добавляет расширение, если его нет", () => {
    expect(fileNameFromUrl("https://cdn.example/a/banner")).toBe("banner.jpg");
  });

  it("чистит небезопасные символы и разбирает percent-encoding", () => {
    expect(fileNameFromUrl("https://cdn.example/%D0%B1%D0%B0%D0%BD%D0%BD%D0%B5%D1%80%20(1).jpg"))
      .toBe("_1_.jpg");
  });

  it("на мусорном URL отдаёт запасное имя", () => {
    expect(fileNameFromUrl("не ссылка")).toBe("creative.jpg");
    expect(fileNameFromUrl("https://cdn.example/")).toBe("creative.jpg");
  });
});
