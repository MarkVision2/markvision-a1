import { describe, expect, it } from "vitest";
import {
  buildAspectWebhookFields,
  normalizeWizardAspect,
  resolveAspectPixels,
  toSerializableWizardState,
} from "@/lib/contentFactoryAspect";
import { buildStyleBrief } from "@/data/styleBriefs";

describe("contentFactoryAspect", () => {
  it("normalizes 9:16 and maps to 1080×1920", () => {
    expect(normalizeWizardAspect(" 9 x 16 ")).toBe("9:16");
    expect(resolveAspectPixels("9:16")).toEqual({
      aspect: "9:16",
      width: 1080,
      height: 1920,
    });
  });

  it("does not silently fall back to 4:5 when 9:16 is chosen", () => {
    const fields = buildAspectWebhookFields("9:16");
    expect(fields.flat.aspect).toBe("9:16");
    expect(fields.flat.aspect_ratio).toBe("9:16");
    expect(fields.flat.width).toBe(1080);
    expect(fields.flat.height).toBe(1920);
    expect(fields.briefLine).toContain("9:16");
    expect(fields.briefLine).toMatch(/не подменять на 4:5/i);
  });

  it("puts chosen aspect into technical brief", () => {
    const built = buildStyleBrief({
      styleId: "before_after",
      userBrief: "Тестовый оффер",
      format: { aspect: "9:16", lang: "ru", variants: 5 },
    });
    expect(built.technicalBrief).toContain("9:16");
    expect(built.technicalBrief).not.toMatch(/соотношение сторон:\s*4:5/i);
  });

  it("strips File objects for history state", () => {
    const file = new File(["x"], "logo.png", { type: "image/png" });
    const out = toSerializableWizardState({
      typeId: "facebook-ads",
      aspect: "9:16",
      variants: 7,
      logoFile: file,
      photos: [file],
      peoplePhotos: [],
    });
    expect(out).not.toHaveProperty("logoFile");
    expect(out).not.toHaveProperty("photos");
    expect(out.aspect).toBe("9:16");
    expect(out.variants).toBe(7);
    expect(out.hasLogo).toBe(true);
    expect(out.photosCount).toBe(1);
  });
});
