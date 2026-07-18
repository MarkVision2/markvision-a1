import { supabaseUrl } from "@/lib/supabaseConfig";

export const IG_ORGANIC_INTAKE_URL = `${supabaseUrl}/functions/v1/instagram-organic-intake`;
export const IG_ORGANIC_REDIRECT_BASE = `${supabaseUrl}/functions/v1/ig-organic-redirect`;

/** Короткая ссылка для ответа бота в DM (фиксирует link_click). */
export function igOrganicBotLink(shortId: string, username = "user", linkIndex?: number) {
  const u = encodeURIComponent(username.replace(/^@/, ""));
  const params = new URLSearchParams({ c: shortId, u });
  if (linkIndex != null && linkIndex >= 0) params.set("v", String(linkIndex));
  return `${IG_ORGANIC_REDIRECT_BASE}?${params.toString()}`;
}
