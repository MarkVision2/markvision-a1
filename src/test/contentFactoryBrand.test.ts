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

  it("includes brandbook images in image_urls but not PDFs", () => {
    const withBookImages: BrandTemplate = {
      ...sample,
      brandbook_urls: [
        "https://cdn.example/book.pdf",
        "https://cdn.example/palette.png",
        "https://cdn.example/typography.webp",
      ],
    };
    expect(brandImageUrls(withBookImages)).toEqual([
      "https://cdn.example/logo.png",
      "https://cdn.example/ref1.png",
      "https://cdn.example/palette.png",
      "https://cdn.example/typography.webp",
    ]);
  });

  it("brand prompt block marks strict compliance", () => {
    const block = brandPromptBlock(sample);
    expect(block).toContain("=== БРЕНД-ШАБЛОН");
    expect(block).toContain("строго соблюдать");
    expect(block).toContain("=== КОНЕЦ БРЕНД-ШАБЛОНА ===");
  });
});
