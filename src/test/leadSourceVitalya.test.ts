import { describe, expect, it } from "vitest";
import { canonicalSourceKey, normalizeSource, resolveLeadSource } from "@/lib/leadSource";

describe("leadSource · Виталя (utm_source=vit)", () => {
  it("мапит vit / виталя в лейбл Виталя", () => {
    expect(normalizeSource("vit").label).toBe("Виталя");
    expect(normalizeSource("vit").key).toBe("vitalya");
    expect(normalizeSource("виталя").label).toBe("Виталя");
    expect(normalizeSource("vitalya").label).toBe("Виталя");
  });

  it("canonical для CRM — виталя", () => {
    expect(canonicalSourceKey("vit")).toBe("виталя");
    expect(canonicalSourceKey("Виталя")).toBe("виталя");
  });

  it("resolveLeadSource читает source лида", () => {
    expect(resolveLeadSource({ source: "vit" }).label).toBe("Виталя");
    expect(resolveLeadSource({ source: "виталя" }).label).toBe("Виталя");
  });
});
