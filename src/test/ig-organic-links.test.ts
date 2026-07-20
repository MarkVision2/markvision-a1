import { describe, expect, it } from "vitest";
import { igOrganicBotLink, igOrganicRawRedirectLink } from "@/lib/igOrganicLinks";

describe("igOrganicBotLink", () => {
  it("builds short markvision link with username", () => {
    const url = igOrganicBotLink("abc123XY", "@maria_kz");
    expect(url).toBe("https://www.markvision.kz/r/abc123XY?u=maria_kz");
  });

  it("stamps media and ad ids for attribution", () => {
    const url = igOrganicBotLink("abc123XY", {
      username: "maria_kz",
      mediaId: "17890123456789012",
      adId: "120250961330840110",
      linkIndex: 1,
    });
    expect(url).toContain("https://www.markvision.kz/r/abc123XY?");
    expect(url).toContain("u=maria_kz");
    expect(url).toContain("v=1");
    expect(url).toContain("m=17890123456789012");
    expect(url).toContain("ad=120250961330840110");
  });

  it("keeps raw supabase link helper for tooling", () => {
    const url = igOrganicRawRedirectLink("abc123XY", {
      username: "@maria_kz",
      mediaId: "media-1",
      adId: "9902003",
    });
    expect(url).toContain("ig-organic-redirect");
    expect(url).toContain("c=abc123XY");
    expect(url).toContain("u=maria_kz");
    expect(url).toContain("m=media-1");
    expect(url).toContain("ad=9902003");
  });
});
