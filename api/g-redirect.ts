/**
 * Public short-link: /g/:slug → group-invite-redirect
 * Tracks click, then 302 to chat.whatsapp.com invite.
 */
const REDIRECT_FN =
  "https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/group-invite-redirect";

export default async function handler(
  req: { method?: string; query?: Record<string, string | string[] | undefined> },
  res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (b?: string) => void;
  },
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const q = req.query ?? {};
  const slugRaw = q.slug ?? q.s;
  const slug = Array.isArray(slugRaw) ? slugRaw[0] : slugRaw;
  if (!slug || typeof slug !== "string") {
    res.statusCode = 400;
    res.end("Missing slug");
    return;
  }

  const params = new URLSearchParams();
  params.set("s", slug.trim().toLowerCase());
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "src", "ref"] as const) {
    const raw = q[key];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (val != null && String(val).trim() !== "") params.set(key, String(val));
  }

  res.statusCode = 302;
  res.setHeader("Location", `${REDIRECT_FN}?${params.toString()}`);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
