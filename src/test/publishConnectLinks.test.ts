/**
 * Ссылки-приглашения — чистая логика (supabase/functions/_lib/publishConnectLinks.ts)
 * и разбор ответа Meta для выбора страницы Instagram.
 *
 * Ломается тихо: срок и лимит ссылки считаются и на сервере (пускать ли на
 * площадку), и в интерфейсе (какой чип показать) — расхождение здесь означает
 * «ссылка выглядит активной, но не работает».
 */
import { describe, expect, it } from "vitest";
import {
  allowedPlatforms,
  connectLinkState,
  connectLinkUrl,
  connectLinkUsable,
  generateConnectToken,
  isConnectLinkPlatform,
  sanitizePlatforms,
} from "../../supabase/functions/_lib/publishConnectLinks.ts";
import { parseMetaPages } from "../../supabase/functions/_lib/publishOAuth.ts";

const base = { platforms: [], max_uses: null, used_count: 0, expires_at: null, revoked_at: null };
const NOW = Date.parse("2026-09-10T12:00:00Z");

describe("состояние ссылки-приглашения", () => {
  it("свежая ссылка активна", () => {
    expect(connectLinkState(base, NOW)).toBe("active");
    expect(connectLinkUsable(base, NOW)).toBe(true);
  });

  it("отзыв сильнее срока и лимита — иначе отозванная ссылка «оживёт»", () => {
    const link = { ...base, revoked_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-02T00:00:00Z", max_uses: 1, used_count: 5 };
    expect(connectLinkState(link, NOW)).toBe("revoked");
  });

  it("истёкший срок и исчерпанный лимит различаются — клиенту нужен разный текст", () => {
    expect(connectLinkState({ ...base, expires_at: "2026-09-09T00:00:00Z" }, NOW)).toBe("expired");
    expect(connectLinkState({ ...base, expires_at: "2026-09-11T00:00:00Z" }, NOW)).toBe("active");
    expect(connectLinkState({ ...base, max_uses: 2, used_count: 2 }, NOW)).toBe("exhausted");
    expect(connectLinkState({ ...base, max_uses: 2, used_count: 1 }, NOW)).toBe("active");
  });
});

describe("площадки ссылки", () => {
  it("пустой список значит «все»", () => {
    expect(allowedPlatforms({ platforms: [] })).toEqual(["instagram", "tiktok", "youtube", "threads"]);
    expect(allowedPlatforms({ platforms: null })).toHaveLength(4);
  });

  it("явный список сохраняется, мусор отбрасывается", () => {
    expect(allowedPlatforms({ platforms: ["tiktok", "vk"] })).toEqual(["tiktok"]);
  });

  it("выбор всех площадок хранится как пустой список", () => {
    expect(sanitizePlatforms(["instagram", "tiktok", "youtube", "threads"])).toEqual([]);
    expect(sanitizePlatforms(["instagram", "instagram", "vk"])).toEqual(["instagram"]);
    expect(sanitizePlatforms("нет")).toEqual([]);
  });

  it("площадка узнаётся по имени", () => {
    expect(isConnectLinkPlatform("youtube")).toBe(true);
    expect(isConnectLinkPlatform("facebook")).toBe(false);
  });
});

describe("токен и адрес", () => {
  it("токен без символов, которые ломают ссылку в мессенджере", () => {
    for (let i = 0; i < 20; i++) expect(generateConnectToken()).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("два токена не совпадают", () => {
    expect(generateConnectToken()).not.toBe(generateConnectToken());
  });

  it("адрес собирается без двойного слэша", () => {
    expect(connectLinkUrl("https://markvision.kz/", "abc")).toBe("https://markvision.kz/connect/abc");
  });
});

describe("страницы Facebook для выбора Instagram", () => {
  const body = {
    data: [
      {
        id: "p1",
        name: "Клиника",
        access_token: "tok-1",
        instagram_business_account: { id: "ig1", username: "clinic", name: "Клиника", followers_count: 1200 },
      },
      // Страница без Instagram — публиковать нечем.
      { id: "p2", name: "Личная", access_token: "tok-2" },
      // Instagram есть, а токена страницы Meta не дала — тоже мимо.
      { id: "p3", name: "Без токена", instagram_business_account: { id: "ig3" } },
    ],
  };

  it("подключаемой считается только страница с Instagram и токеном", () => {
    const pages = parseMetaPages(body);
    expect(pages.map((p) => p.page_id)).toEqual(["p1", "p2", "p3"]);
    expect(pages.filter((p) => p.connectable).map((p) => p.page_id)).toEqual(["p1"]);
  });

  it("данные Instagram переносятся в карточку выбора", () => {
    const [first] = parseMetaPages(body);
    expect(first).toMatchObject({ ig_user_id: "ig1", ig_username: "clinic", ig_followers: 1200, page_token: "tok-1" });
  });

  it("ответ без data не роняет разбор", () => {
    expect(parseMetaPages({ error: { message: "bad token" } })).toEqual([]);
    expect(parseMetaPages(null)).toEqual([]);
  });
});
