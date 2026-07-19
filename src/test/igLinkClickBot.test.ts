import { describe, it, expect } from "vitest";
import { isLinkClickBotUa } from "@/lib/igLinkClickBot";

describe("isLinkClickBotUa", () => {
  it("flags Meta link preview crawler", () => {
    expect(isLinkClickBotUa("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
  });

  it("keeps normal mobile browsers", () => {
    expect(
      isLinkClickBotUa(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0",
      ),
    ).toBe(false);
  });

  it("treats empty UA as human (same as content-center predicate)", () => {
    expect(isLinkClickBotUa(null)).toBe(false);
    expect(isLinkClickBotUa("")).toBe(false);
  });
});
