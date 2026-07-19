import { supabaseUrl } from "@/lib/supabaseConfig";

export const IG_ORGANIC_INTAKE_URL = `${supabaseUrl}/functions/v1/instagram-organic-intake`;
export const IG_ORGANIC_REDIRECT_BASE = `${supabaseUrl}/functions/v1/ig-organic-redirect`;

/** Короткая публичная ссылка (кнопка в Direct) → redirect + link_click. */
export const IG_PUBLIC_SHORT_ORIGIN = "https://www.markvision.kz";

/** Короткая ссылка для ответа бота в DM (фиксирует link_click). */
export function igOrganicBotLink(shortId: string, username = "user", linkIndex?: number) {
  const params = new URLSearchParams();
  const u = username.replace(/^@/, "").trim();
  if (u) params.set("u", u);
  if (linkIndex != null && linkIndex >= 0) params.set("v", String(linkIndex));
  const q = params.toString();
  return `${IG_PUBLIC_SHORT_ORIGIN}/r/${encodeURIComponent(shortId)}${q ? `?${q}` : ""}`;
}

/** Legacy supabase redirect (если нужен прямой вызов функции). */
export function igOrganicRawRedirectLink(shortId: string, username = "user", linkIndex?: number) {
  const u = encodeURIComponent(username.replace(/^@/, ""));
  const params = new URLSearchParams({ c: shortId, u });
  if (linkIndex != null && linkIndex >= 0) params.set("v", String(linkIndex));
  return `${IG_ORGANIC_REDIRECT_BASE}?${params.toString()}`;
}
