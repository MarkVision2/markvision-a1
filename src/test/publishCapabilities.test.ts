/** Возможности аккаунта площадки (_lib/publishCapabilities.ts). */
import { describe, expect, it } from "vitest";
import { CAPABILITY_LIST, hasCapability, resolveCapabilities, tokenKindOf } from "../../supabase/functions/_lib/publishCapabilities.ts";

describe("форма токена", () => {
  it("различает Instagram Login, Page token и прочие OAuth", () => {
    expect(tokenKindOf("IGAAxyz")).toBe("ig_login");
    expect(tokenKindOf("EAAGxyz")).toBe("fb_page");
    expect(tokenKindOf("ya29.a0")).toBe("oauth");
    expect(tokenKindOf(null)).toBe("unknown");
  });
});

describe("resolveCapabilities", () => {
  it("возвращает полный словарь для каждой площадки", () => {
    for (const platform of ["instagram", "threads", "tiktok", "youtube"]) {
      const caps = resolveCapabilities({ platform });
      expect(Object.keys(caps).sort()).toEqual([...CAPABILITY_LIST].sort());
      expect(caps.publish_video).toBe(true);
      expect(caps.get_publication).toBe(true);
    }
  });

  it("TikTok без video.list не читает пост и статистику", () => {
    const caps = resolveCapabilities({ platform: "tiktok", oauthScope: "user.info.basic,video.publish" });
    expect(caps.publish_video).toBe(true);
    expect(caps.get_publication).toBe(false);
    expect(caps.get_insights).toBe(false);
    expect(resolveCapabilities({ platform: "tiktok", oauthScope: "user.info.basic,video.publish,video.list" }).get_publication).toBe(true);
  });

  it("Instagram: page-токен не продлевается, Instagram Login — да; удаление медиа недоступно", () => {
    expect(resolveCapabilities({ platform: "instagram", tokenKind: "fb_page" }).refresh_token).toBe(false);
    expect(resolveCapabilities({ platform: "instagram", tokenKind: "ig_login" }).refresh_token).toBe(true);
    expect(resolveCapabilities({ platform: "instagram" }).delete_publication).toBe(false);
  });

  it("YouTube: без scope youtube.upload публиковать нельзя", () => {
    expect(resolveCapabilities({ platform: "youtube", oauthScope: "https://www.googleapis.com/auth/youtube.readonly" }).publish_video).toBe(false);
    expect(resolveCapabilities({ platform: "youtube", oauthScope: "https://www.googleapis.com/auth/youtube.upload" }).publish_video).toBe(true);
  });

  it("неизвестная площадка ничего не умеет", () => {
    expect(Object.values(resolveCapabilities({ platform: "vk" })).every((v) => v === false)).toBe(true);
  });
});

describe("hasCapability", () => {
  it("пустой jsonb (ещё не резолвили) — считается разрешённым; заполненный — по значению", () => {
    expect(hasCapability({}, "publish_video")).toBe(true);
    expect(hasCapability(null, "publish_video")).toBe(true);
    expect(hasCapability({ publish_video: false }, "publish_video")).toBe(false);
    expect(hasCapability({ publish_video: true }, "get_publication")).toBe(false);
  });
});
