/**
 * Meta CDN отдаёт thumbnail_url с фиксированным размером 64x64
 * (параметр `p64x64` внутри `stp=...`). Это даёт сильно размытое превью
 * после апскейла. Эта утилита поднимает разрешение до 480x480 — превью
 * становится чётким, при этом ссылка остаётся валидной (CDN сам ресайзит).
 */
export function upscaleMetaThumb(url: string | null | undefined, size = 480): string | null {
  if (!url) return null;
  // p64x64 → p480x480 (внутри stp= параметра)
  let out = url.replace(/p\d{2,4}x\d{2,4}/g, `p${size}x${size}`);
  // q75 → q90 (выше качество jpeg)
  out = out.replace(/[?&_]q\d{1,3}\b/g, (m) => m.replace(/q\d{1,3}/, "q90"));
  return out;
}

/** Лучший доступный URL картинки для креатива. */
export function bestCreativeImage(args: {
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  size?: number;
}): string | null {
  // image_url — это полноразмерный постер, всегда лучше thumbnail.
  if (args.imageUrl) return args.imageUrl;
  return upscaleMetaThumb(args.thumbnailUrl, args.size ?? 480);
}
