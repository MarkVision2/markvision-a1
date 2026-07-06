import { supabaseUrl } from "@/lib/supabaseConfig";

export const IG_ORGANIC_INTAKE_URL = `${supabaseUrl}/functions/v1/instagram-organic-intake`;
export const IG_ORGANIC_REDIRECT_BASE = `${supabaseUrl}/functions/v1/ig-organic-redirect`;

/** Короткая ссылка для ответа бота в DM (фиксирует link_click). */
export function igOrganicBotLink(shortId: string, username = "user") {
  const u = encodeURIComponent(username.replace(/^@/, ""));
  return `${IG_ORGANIC_REDIRECT_BASE}?c=${encodeURIComponent(shortId)}&u=${u}`;
}
