import { describe, it, expect } from "vitest";
import {
  bestCreativeImage,
  isHighQualityCreativeUrl,
  isLowResMetaThumb,
  upscaleMetaThumb,
} from "@/lib/metaThumb";

describe("metaThumb", () => {
  it("определяет p64x64 как низкое разрешение", () => {
    const url = "https://scontent-xxx.xx.fbcdn.net/v/.../stp=dst-jpg_p64x64_q75";
    expect(isLowResMetaThumb(url)).toBe(true);
    expect(isHighQualityCreativeUrl(url)).toBe(false);
  });

  it("считает poster из Storage HQ", () => {
    const url = "https://xxx.supabase.co/storage/v1/object/public/creative-posters/ad-1.jpg";
    expect(isHighQualityCreativeUrl(url)).toBe(true);
    expect(bestCreativeImage({ posterUrl: url })).toBe(url);
  });

  it("не возвращает подписанный scontent p64x64 (нельзя апскейлить)", () => {
    const low = "https://scontent-xxx.xx.fbcdn.net/v/abc?__cft__=1&stp=dst-jpg_p64x64_q75";
    expect(bestCreativeImage({ thumbnailUrl: low })).toBeNull();
  });

  it("апскейлит external превью", () => {
    const url = "https://external-xxx.fbcdn.net/stp=dst-jpg_p64x64_q75";
    const up = upscaleMetaThumb(url, 720);
    expect(up).toContain("p720x720");
    expect(isLowResMetaThumb(up!)).toBe(false);
  });

  it("приоритет: poster > image > thumbnail", () => {
    const poster = "https://xxx.supabase.co/storage/v1/object/public/creative-posters/a.jpg";
    const image = "https://external.fbcdn.net/p720x720.jpg";
    const thumb = "https://scontent.xx.fbcdn.net/p64x64";
    expect(bestCreativeImage({ posterUrl: poster, imageUrl: image, thumbnailUrl: thumb })).toBe(poster);
    expect(bestCreativeImage({ imageUrl: image, thumbnailUrl: thumb })).toBe(image);
  });
});
