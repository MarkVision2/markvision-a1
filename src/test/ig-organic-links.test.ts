import { describe, expect, it } from "vitest";
import { igOrganicBotLink, igOrganicRawRedirectLink } from "@/lib/igOrganicLinks";

describe("igOrganicBotLink", () => {
  it("builds short markvision link with username", () => {
    const url = igOrganicBotLink("abc123XY", "@maria_kz");
    expect(url).toBe("https://www.markvision.kz/r/abc123XY?u=maria_kz");
  });

  it("keeps raw supabase link helper for tooling", () => {
    const url = igOrganicRawRedirectLink("abc123XY", "@maria_kz");
    expect(url).toContain("ig-organic-redirect");
    expect(url).toContain("c=abc123XY");
    expect(url).toContain("u=maria_kz");
  });
});
