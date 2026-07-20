import { describe, expect, it } from "vitest";
import {
  getMontageStyle,
  parseMontageStyleFromBrief,
  MONTAGE_STYLE_TEMPLATES,
} from "@/lib/montageTemplates";

describe("montageTemplates", () => {
  it("defaults to expert-explainer", () => {
    const s = getMontageStyle(undefined);
    expect(s.id).toBe("expert-explainer");
    expect(s.captionStyle).toBe("karaoke-box");
    expect(s.recommended).toBe(true);
  });

  it("parses style marker from brief", () => {
    expect(parseMontageStyleFromBrief("hello\n[STYLE=classic]\n")).toBe("classic");
    expect(parseMontageStyleFromBrief(null)).toBe("expert-explainer");
  });

  it("exposes three templates with thumbs", () => {
    expect(MONTAGE_STYLE_TEMPLATES).toHaveLength(3);
    for (const t of MONTAGE_STYLE_TEMPLATES) {
      expect(t.thumb).toMatch(/^\/montage-templates\//);
      expect(t.aiRules.length).toBeGreaterThan(20);
    }
  });
});
