import { describe, it, expect } from "vitest";
import { DM_ACCESS_BUTTON_TITLE } from "@/components/settings/InstagramOrganicSettings";
import { CODEWORD_MAX_VARIANTS, normalizeVariantList } from "@/lib/codewordVariants";

describe("codeword form defaults", () => {
  it("keeps fixed DM button title within Meta 20-char limit", () => {
    expect(DM_ACCESS_BUTTON_TITLE).toBe("получить доступ");
    expect(Array.from(DM_ACCESS_BUTTON_TITLE).length).toBeLessThanOrEqual(20);
  });

  it("caps variants at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => `v${i + 1}`);
    expect(normalizeVariantList(many)).toHaveLength(CODEWORD_MAX_VARIANTS);
  });
});
