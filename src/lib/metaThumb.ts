/**
 * Meta CDN отдаёт thumbnail_url с фиксированным размером 64x64
 * (параметр `p64x64` внутри `stp=...`). Это даёт сильно размытое превью
 * после апскейла. Эта утилита поднимает разрешение до 480x480 — превью
 * становится чётким, при этом ссылка остаётся валидной (CDN сам ресайзит).
 */
export function upscaleMetaThumb(url: string | null | undefined, size = 480): string | null {
  if (!url) return null;
  // У scontent/fbcdn ссылки подписаны под конкретный stp. Если заменить p64x64
  // на p720x720, Meta часто отдаёт 403 — в итоге видео-превью становится пустым.
  // Поэтому апскейлим только external-* превью, а подписанные CDN-постеры оставляем как есть.
  if (/\/scontent-[^/]+\.xx\.fbcdn\.net\//i.test(url) || /[?&]__cft__=|[?&]_nc_ht=/i.test(url)) {
    return url;
  }
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
