/**
 * Маршрутизация Контент-завода → n8n Switch (workflow dCQ20aXv6B9LRjDe).
 * content_type / route должны совпадать с ветками воркфлоу ровно.
 */
export const CONTENT_TYPE_ROUTE_MAP: Record<string, string> = {
  "facebook-ads": "fb-target",
  "google-ads": "google-ads",
  marketplace: "marketplace",
  "insta-carousel": "insta-carousel",
  "reels-cover": "reels-cover",
  stories: "instagram-stories",
  "youtube-thumb": "youtube",
  "web-banner": "banner",
  "neuro-photo": "neuro-photo",
};

export function resolveContentTypeRoute(typeId: string | undefined | null): string {
  if (!typeId) return "fb-target";
  return CONTENT_TYPE_ROUTE_MAP[typeId] ?? "fb-target";
}

export function isNeuroPhotoTypeId(typeId: string | undefined | null): boolean {
  return typeId === "neuro-photo";
}
