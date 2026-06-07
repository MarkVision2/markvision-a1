/**
 * Meta CDN часто отдаёт thumbnail_url в 64×64 (p64x64 в stp=...).
 * При растягивании на карточку 9:16 превью выглядит размытым.
 * Эта утилита определяет низкое разрешение и выбирает лучший URL.
 */

const LOW_RES_PATTERNS = [
  /p64x64/i,
  /s60x60/i,
  /s32x32/i,
  /p96x96/i,
  /p128x128/i,
  /_s\d{2,3}x\d{2,3}_/i,
];

const HQ_STORAGE_HINTS = [
  /creative-posters/i,
  /supabase\.co\/storage/i,
];

/** URL явно указывает на миниатюру ≤128px. */
export function isLowResMetaThumb(url: string | null | undefined): boolean {
  if (!url) return true;
  if (HQ_STORAGE_HINTS.some((re) => re.test(url))) return false;
  if (LOW_RES_PATTERNS.some((re) => re.test(url))) return true;
  const dim = url.match(/[?&](?:w|width)=(\d+)/i);
  if (dim && Number(dim[1]) <= 128) return true;
  return false;
}

/** Достаточно качества для показа на карточке. */
export function isHighQualityCreativeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (HQ_STORAGE_HINTS.some((re) => re.test(url))) return true;
  return !isLowResMetaThumb(url);
}

/**
 * Meta CDN: external-* превью можно апскейлить безопасно.
 * scontent/fbcdn подписаны — менять stp нельзя (403), но external можно.
 */
export function upscaleMetaThumb(url: string | null | undefined, size = 720): string | null {
  if (!url) return null;
  if (isHighQualityCreativeUrl(url)) return url;

  const isSignedCdn =
    /\/scontent-[^/]+\.xx\.fbcdn\.net\//i.test(url)
    || /[?&]__cft__=|[?&]_nc_ht=/i.test(url);

  if (isSignedCdn) return null;

  let out = url.replace(/p\d{2,4}x\d{2,4}/gi, `p${size}x${size}`);
  out = out.replace(/s\d{2,4}x\d{2,4}/gi, `s${size}x${size}`);
  out = out.replace(/[?&_]q\d{1,3}\b/g, (m) => m.replace(/q\d{1,3}/, "q90"));
  return isLowResMetaThumb(out) ? null : out;
}

/** Лучший доступный URL картинки для креатива (null = не показывать blur). */
export function bestCreativeImage(args: {
  posterUrl?: string | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  size?: number;
}): string | null {
  const size = args.size ?? 720;
  const candidates: Array<string | null | undefined> = [
    args.posterUrl,
    args.imageUrl,
    upscaleMetaThumb(args.thumbnailUrl, size),
    args.thumbnailUrl,
  ];

  for (const url of candidates) {
    if (url && isHighQualityCreativeUrl(url)) return url;
  }
  return null;
}
