const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export const IG_ORGANIC_INTAKE_URL = `${SUPABASE_URL}/functions/v1/instagram-organic-intake`;
export const IG_ORGANIC_REDIRECT_BASE = `${SUPABASE_URL}/functions/v1/ig-organic-redirect`;

/** Короткая ссылка для ответа бота в DM (фиксирует link_click). */
export function igOrganicBotLink(shortId: string, username = "user") {
  const u = encodeURIComponent(username.replace(/^@/, ""));
  return `${IG_ORGANIC_REDIRECT_BASE}?c=${encodeURIComponent(shortId)}&u=${u}`;
}
