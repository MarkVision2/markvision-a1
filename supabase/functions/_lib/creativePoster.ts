// Общие утилиты для HQ-постеров креативов (Meta → Supabase Storage).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const LOW_RES_RE = /p64x64|p96x96|p128x128|s60x60|s32x32/i;

export function isLowResThumb(url: string): boolean {
  return LOW_RES_RE.test(url);
}

/** Лучший URL из списка: предпочитаем не-миниатюру. */
export function pickBestUrl(...urls: Array<string | null | undefined>): string | null {
  const clean = urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  const hq = clean.find((u) => !isLowResThumb(u));
  return hq ?? clean[0] ?? null;
}

export interface VideoThumbItem {
  uri: string;
  width?: number;
  height?: number;
  is_preferred?: boolean;
}

/** Выбор лучшего постера из thumbnails Meta Video API. */
export function pickBestVideoThumb(
  thumbs: VideoThumbItem[],
  picture?: string | null,
): string | null {
  if (thumbs.length) {
    const preferred = thumbs.find((t) => t.is_preferred);
    const sorted = [...thumbs].sort(
      (a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)),
    );
    const fromPreferred =
      preferred?.uri && (preferred.width ?? 0) >= 200 && !isLowResThumb(preferred.uri)
        ? preferred.uri
        : null;
    const fromSorted = sorted.find(
      (t) => (t.width ?? 0) * (t.height ?? 0) >= 200 * 200 && !isLowResThumb(t.uri),
    )?.uri ?? null;
    const best = fromPreferred ?? fromSorted ?? sorted[0]?.uri ?? null;
    if (best && !isLowResThumb(best)) return best;
  }
  if (picture && !isLowResThumb(picture)) return picture;
  return pickBestUrl(picture, thumbs[0]?.uri ?? null);
}

export function isSupabasePosterUrl(url: string): boolean {
  return /creative-posters/i.test(url) || /supabase\.co\/storage/i.test(url);
}

/** Скачивает изображение с Meta CDN и кладёт в creative-posters. */
export async function uploadPosterFromUrl(
  admin: SupabaseClient,
  adId: string,
  cabinetId: string | null | undefined,
  imageUrl: string,
): Promise<string | null> {
  try {
    const r = await fetch(imageUrl, { redirect: "follow" });
    if (!r.ok) return null;
    const contentType = r.headers.get("content-type") ?? "image/jpeg";
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength < 400 || buf.byteLength > 3_000_000) return null;

    const path = `${cabinetId ?? "shared"}/${adId}.jpg`;
    const { error: upErr } = await admin.storage.from("creative-posters").upload(path, buf, {
      contentType: contentType.includes("png") ? "image/png" : "image/jpeg",
      cacheControl: "604800",
      upsert: true,
    });
    if (upErr) return null;

    const { data: pub } = admin.storage.from("creative-posters").getPublicUrl(path);
    return pub.publicUrl;
  } catch {
    return null;
  }
}

/** Если URL HQ — заливает в Storage и возвращает публичный poster_url. */
export async function ensurePosterInStorage(
  admin: SupabaseClient,
  adId: string,
  cabinetId: string | null | undefined,
  existingPosterUrl: string | null | undefined,
  remoteThumbUrl: string | null | undefined,
): Promise<string | null> {
  if (existingPosterUrl && isSupabasePosterUrl(existingPosterUrl)) {
    return existingPosterUrl;
  }
  if (!remoteThumbUrl || isLowResThumb(remoteThumbUrl)) return null;
  const uploaded = await uploadPosterFromUrl(admin, adId, cabinetId, remoteThumbUrl);
  if (!uploaded) return null;

  await admin
    .from("meta_creatives")
    .update({
      poster_url: uploaded,
      thumbnail_url: remoteThumbUrl,
      image_url: remoteThumbUrl,
      last_synced_at: new Date().toISOString(),
    })
    .eq("ad_id", adId);

  return uploaded;
}
