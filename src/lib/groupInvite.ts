/** Публичные tracked-ссылки на WhatsApp-группу: https://www.markvision.kz/g/<slug> */

export const TRACKED_INVITE_BASE = "https://www.markvision.kz/g/";

export function trackedInviteUrl(slug: string, utmSource?: string): string {
  const u = `${TRACKED_INVITE_BASE}${slug}`;
  if (!utmSource?.trim()) return u;
  return `${u}?utm_source=${encodeURIComponent(utmSource.trim())}`;
}

/**
 * Превью-боты при шаринге ссылки (WhatsApp/Telegram/…) дергают URL без вступления.
 * Зеркало логики supabase/functions/group-invite-redirect.
 */
export function isInvitePreviewBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return true;
  const low = ua.toLowerCase();
  const needles = [
    "whatsapp/",
    "telegrambot",
    "twitterbot",
    "facebookexternalhit",
    "facebot",
    "slackbot",
    "discordbot",
    "linkedinbot",
    "vkshare",
    "preview",
    "bot",
    "spider",
    "crawler",
    "curl/",
    "wget/",
    "python-requests",
    "go-http-client",
    "httpclient",
    "axios/",
    "scrapy",
    "headless",
  ];
  return needles.some((n) => low.includes(n));
}
