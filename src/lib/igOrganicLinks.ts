import { supabaseUrl } from "@/lib/supabaseConfig";

export const IG_ORGANIC_INTAKE_URL = `${supabaseUrl}/functions/v1/instagram-organic-intake`;
export const IG_ORGANIC_REDIRECT_BASE = `${supabaseUrl}/functions/v1/ig-organic-redirect`;

/** Короткая публичная ссылка (кнопка в Direct) → redirect + link_click. */
export const IG_PUBLIC_SHORT_ORIGIN = "https://www.markvision.kz";

export type IgOrganicLinkOpts = {
  username?: string;
  linkIndex?: number;
  /** Instagram media id поста/рилса, с которого пришёл человек. */
  mediaId?: string | null;
  /** Meta ad id (из messaging.referral при клике с рекламы). */
  adId?: string | null;
};

function buildQuery(opts: IgOrganicLinkOpts): string {
  const params = new URLSearchParams();
  const u = (opts.username ?? "user").replace(/^@/, "").trim();
  if (u) params.set("u", u);
  if (opts.linkIndex != null && opts.linkIndex >= 0) params.set("v", String(opts.linkIndex));
  if (opts.mediaId) params.set("m", opts.mediaId);
  if (opts.adId) params.set("ad", opts.adId);
  return params.toString();
}

/** Короткая ссылка для ответа бота в DM (фиксирует link_click + пост/рекламу). */
export function igOrganicBotLink(
  shortId: string,
  usernameOrOpts: string | IgOrganicLinkOpts = "user",
  linkIndex?: number,
) {
  const opts: IgOrganicLinkOpts =
    typeof usernameOrOpts === "string"
      ? { username: usernameOrOpts, linkIndex }
      : usernameOrOpts;
  const q = buildQuery(opts);
  return `${IG_PUBLIC_SHORT_ORIGIN}/r/${encodeURIComponent(shortId)}${q ? `?${q}` : ""}`;
}

/** Legacy supabase redirect (если нужен прямой вызов функции). */
export function igOrganicRawRedirectLink(
  shortId: string,
  usernameOrOpts: string | IgOrganicLinkOpts = "user",
  linkIndex?: number,
) {
  const opts: IgOrganicLinkOpts =
    typeof usernameOrOpts === "string"
      ? { username: usernameOrOpts, linkIndex }
      : usernameOrOpts;
  const params = new URLSearchParams({ c: shortId });
  const u = (opts.username ?? "user").replace(/^@/, "").trim();
  if (u) params.set("u", u);
  if (opts.linkIndex != null && opts.linkIndex >= 0) params.set("v", String(opts.linkIndex));
  if (opts.mediaId) params.set("m", opts.mediaId);
  if (opts.adId) params.set("ad", opts.adId);
  return `${IG_ORGANIC_REDIRECT_BASE}?${params.toString()}`;
}
