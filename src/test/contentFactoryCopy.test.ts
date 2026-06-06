import { describe, expect, it } from "vitest";
import {
  buildCopyWebhookFields,
  copyPromptBlock,
  normalizeCopyMode,
} from "@/lib/contentFactoryCopy";

describe("contentFactoryCopy", () => {
  it("normalizes copy mode", () => {
    expect(normalizeCopyMode("custom")).toBe("custom");
    expect(normalizeCopyMode("auto")).toBe("auto");
    expect(normalizeCopyMode(undefined)).toBe("auto");
  });

  it("builds webhook fields for custom overlay", () => {
    const f = buildCopyWebhookFields("custom", "Скидка 30%", "hint");
    expect(f.copy_mode).toBe("custom");
    expect(f.overlay_text).toBe("Скидка 30%");
    expect(f.use_exact_overlay_text).toBe(true);
    expect(f.overlay_text_required).toBe(true);
  });

  it("auto mode clears overlay_text", () => {
    const f = buildCopyWebhookFields("auto", "", "яркие цвета");
    expect(f.overlay_text).toBe("");
    expect(f.use_exact_overlay_text).toBe(false);
    expect(f.extra_instructions).toBe("яркие цвета");
  });

  it("custom prompt demands exact text", () => {
    expect(copyPromptBlock("custom", "Точный текст")).toContain("Точный текст");
    expect(copyPromptBlock("custom", "Точный текст")).toContain("без перефразирования");
    expect(copyPromptBlock("auto", "")).toContain("copy_mode=auto");
  });
});
