/**
 * Public short-link proxy: /r/:code → ig-organic-redirect with full query
 * (u=username, v=link_index). Keeps link_click analytics intact.
 */
const REDIRECT_FN =
  "https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ig-organic-redirect";

export default async function handler(req: { method?: string; query?: Record<string, string | string[] | undefined>; url?: string }, res: {
  statusCode: number;
  setHeader: (k: string, v: string) => void;
  end: (b?: string) => void;
}) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const q = req.query ?? {};
  const codeRaw = q.code ?? q.c;
  const code = Array.isArray(codeRaw) ? codeRaw[0] : codeRaw;
  if (!code || typeof code !== "string") {
    res.statusCode = 400;
    res.end("Missing code");
    return;
  }

  const params = new URLSearchParams();
  params.set("c", code);
  for (const key of ["u", "v"] as const) {
    const raw = q[key];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (val != null && String(val).trim() !== "") params.set(key, String(val));
  }

  const target = `${REDIRECT_FN}?${params.toString()}`;
  // Follow redirect server-side so we return the final Location to the client,
  // or just 302 to the edge function (edge will 302 again to landing).
  res.statusCode = 302;
  res.setHeader("Location", target);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
