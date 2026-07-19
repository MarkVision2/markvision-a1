import { describe, expect, it } from "vitest";
import { computeSourceRect } from "@/lib/cropMedia";
import { defaultFeed45View, FEED_45_FRAME, fileCropKey } from "@/components/autopost/Feed45Crop";

describe("Feed45Crop helpers", () => {
  it("builds stable file keys and default 4:5 view", () => {
    const f = new File([new Uint8Array([1, 2, 3])], "slide.jpg", { type: "image/jpeg" });
    expect(fileCropKey(f)).toContain("slide.jpg");
    const v = defaultFeed45View();
    expect(v.ratio).toBe("4:5");
    expect(v.fit).toBe("cover");
    expect(v.frame).toEqual(FEED_45_FRAME);
  });

  it("computeSourceRect yields 4:5 output for cover crop", () => {
    const rect = computeSourceRect({
      ...defaultFeed45View(),
      natural: { w: 2000, h: 2000 },
    });
    expect(rect.outW / rect.outH).toBeCloseTo(4 / 5, 1);
    expect(rect.outW % 2).toBe(0);
    expect(rect.outH % 2).toBe(0);
  });
});
