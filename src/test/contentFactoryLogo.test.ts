import { describe, expect, it } from "vitest";
import {
  buildLogoWebhookFields,
  logoPromptBlock,
  mergeImageUrls,
  peoplePhotosPromptBlock,
} from "@/lib/contentFactoryLogo";

describe("contentFactoryLogo", () => {
  it("builds logo webhook fields with style instruction", () => {
    const f = buildLogoWebhookFields("https://cdn.example/logo.png", "wizard_upload");
    expect(f.logo_url).toBe("https://cdn.example/logo.png");
    expect(f.logo_type).toBe("wizard_upload");
    expect(String(f.logo_style_instruction)).toContain("logo_url");
  });

  it("returns empty logo fields when no url", () => {
    const f = buildLogoWebhookFields(null);
    expect(f.logo_url).toBe("");
    expect(f.logo_type).toBe("");
  });

  it("merges image urls with logo first", () => {
    expect(
      mergeImageUrls({
        logoUrl: "https://a/logo.png",
        peopleUrls: ["https://a/p1.png"],
        assetUrls: ["https://a/prod.png"],
        brandUrls: ["https://a/ref.png"],
      }),
    ).toEqual([
      "https://a/logo.png",
      "https://a/p1.png",
      "https://a/prod.png",
      "https://a/ref.png",
    ]);
  });

  it("adds logo and people blocks to prompt text", () => {
    expect(logoPromptBlock("https://x/logo.png")).toContain("https://x/logo.png");
    expect(peoplePhotosPromptBlock(2)).toContain("2 фото людей");
  });
});
