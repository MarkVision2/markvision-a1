import { describe, expect, it } from "vitest";
import { igOrganicBotLink } from "@/lib/igOrganicLinks";

describe("igOrganicBotLink", () => {
  it("builds redirect URL with short_id and username", () => {
    const url = igOrganicBotLink("abc123XY", "@maria_kz");
    expect(url).toContain("ig-organic-redirect");
    expect(url).toContain("c=abc123XY");
    expect(url).toContain("u=maria_kz");
  });
});
