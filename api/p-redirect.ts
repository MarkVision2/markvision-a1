/**
 * Partner short-links: /p/:slug → landing with UTM + cid for WhatsApp ref.
 *
 * Landing (zapoinovai) builds WA text as:
 *   Хочу получить доступ
 *   ref:zapoinovai[.cid][.asid][.adid]
 * It does NOT read utm_source into the message — only cid/asid/adid.
 * So we put the partner token into `cid` as well; Green API / CRM then
 * maps `ref:zapoinovai.yuriy` → source=yuriy.
 */
const PARTNERS: Record<string, { utmSource: string; label?: string }> = {
  hub: { utmSource: "astana_hub" },
  dastan: { utmSource: "dastan" },
  nadi: { utmSource: "nadi" },
  yuriy: { utmSource: "yuriy" },
};

const LANDING = "https://zapoinovai.vercel.app/";

function partnerTarget(utmSource: string): string {
  const u = new URL(LANDING);
  u.searchParams.set("utm_source", utmSource);
  u.searchParams.set("utm_medium", "referral");
  u.searchParams.set("utm_campaign", "workshop_aug1");
  // Landing WA CTA only forwards cid/asid/adid into ref: — inject partner here.
  u.searchParams.set("cid", utmSource);
  return u.toString();
}

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

  const raw = req.query?.slug ?? req.query?.s;
  const slug = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().toLowerCase();
  const partner = slug ? PARTNERS[slug] : undefined;

  if (!partner) {
    res.statusCode = 404;
    res.end("Unknown partner link");
    return;
  }

  res.statusCode = 302;
  res.setHeader("Location", partnerTarget(partner.utmSource));
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
