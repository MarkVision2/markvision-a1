/** User-Agent превью/краулеров, которые не считаем кликом по кнопке. */
const BOT_UA_RE =
  /(bot|crawler|spider|preview|facebookcatalog|facebookexternalhit|whatsapp|telegram|slack|discord|vkshare|skypeuripreview)/i;

export function isLinkClickBotUa(ua: string | null | undefined): boolean {
  const s = (ua ?? "").trim();
  if (!s) return false;
  return BOT_UA_RE.test(s);
}
