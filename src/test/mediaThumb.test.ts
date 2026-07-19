import { describe, expect, it } from "vitest";
import { looksLikeVideoUrl } from "@/components/autopost/MediaThumb";

describe("looksLikeVideoUrl", () => {
  it("detects common video extensions", () => {
    expect(looksLikeVideoUrl("https://cdn.example/a.mp4")).toBe(true);
    expect(looksLikeVideoUrl("https://cdn.example/a.MP4?x=1")).toBe(true);
    expect(looksLikeVideoUrl("https://cdn.example/a.mov")).toBe(true);
  });

  it("rejects images", () => {
    expect(looksLikeVideoUrl("https://cdn.example/a.jpg")).toBe(false);
    expect(looksLikeVideoUrl("https://cdn.example/a.png?w=200")).toBe(false);
    expect(looksLikeVideoUrl(null)).toBe(false);
  });
});
