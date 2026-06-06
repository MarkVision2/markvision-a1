import { describe, expect, it } from "vitest";
import {
  brandImageUrls,
  brandPromptBlock,
  buildBrandWebhookFields,
  type BrandTemplate,
} from "@/lib/contentFactoryBrand";

const sample: BrandTemplate = {
  id: "t1",
  project_id: "p1",
  name: "Test Brand",
  description: "Premium clinic",
  colors: { primary: "#111", secondary: "#222", accent: "#f00" },
  fonts: { heading: "Montserrat", body: "Inter" },
  tone: "Экспертный",
  style_notes: "Минимализм",
  prompt_addon: "Без клише",
  logo_url: "https://cdn.example/logo.png",
  reference_urls: ["https://cdn.example/ref1.png"],
  brandbook_urls: ["https://cdn.example/book.pdf"],
  is_default: true,
  created_at: "",
  updated_at: "",
};

describe("contentFactoryBrand", () => {
  it("builds webhook fields with flat brand keys", () => {
    const f = buildBrandWebhookFields(sample);
    expect(f.brand_name).toBe("Test Brand");
    expect(f.brand_logo_url).toBe("https://cdn.example/logo.png");
    expect(f.brand_reference_urls).toEqual(["https://cdn.example/ref1.png"]);
    expect((f.brand_template as { name: string }).name).toBe("Test Brand");
  });

  it("appends brand block to prompt", () => {
    expect(brandPromptBlock(sample)).toContain("Test Brand");
    expect(brandPromptBlock(sample)).toContain("Montserrat");
  });

  it("collects logo and refs for image_urls", () => {
    expect(brandImageUrls(sample)).toEqual([
      "https://cdn.example/logo.png",
      "https://cdn.example/ref1.png",
    ]);
  });
});
