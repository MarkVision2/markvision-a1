import { describe, expect, it } from "vitest";
import { ensureJpegCoverFile } from "@/lib/autopostAiCaption";

describe("ensureJpegCoverFile", () => {
  it("passes through JPEG unchanged", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" });
    const out = await ensureJpegCoverFile(jpeg);
    expect(out).toBe(jpeg);
  });
});
