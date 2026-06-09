import { describe, expect, it } from "vitest";
import {
  buildCreativeUsernameWebhookFields,
  formatCreativeUsernameDisplay,
  normalizeCreativeUsername,
} from "@/lib/projectCreativeUsername";

describe("projectCreativeUsername", () => {
  it("normalizes @ and invalid chars", () => {
    expect(normalizeCreativeUsername("@zapoinov")).toBe("zapoinov");
    expect(normalizeCreativeUsername("  @Zapo.Inov_1  ")).toBe("Zapo.Inov_1");
    expect(normalizeCreativeUsername("@bad name!")).toBe("badname");
  });

  it("returns empty webhook fields when nick is blank", () => {
    expect(buildCreativeUsernameWebhookFields("")).toEqual({});
    expect(buildCreativeUsernameWebhookFields("   ")).toEqual({});
    expect(buildCreativeUsernameWebhookFields(null)).toEqual({});
  });

  it("sends username without @ when nick is set", () => {
    expect(buildCreativeUsernameWebhookFields("@zapoinov")).toEqual({ username: "zapoinov" });
  });

  it("formats display with @", () => {
    expect(formatCreativeUsernameDisplay("zapoinov")).toBe("@zapoinov");
    expect(formatCreativeUsernameDisplay("")).toBe("");
  });
});
