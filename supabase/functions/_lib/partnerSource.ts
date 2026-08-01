/**
 * Partner attribution from WhatsApp prefilled messages on zapoinovai landing.
 *
 * Landing builds: `Хочу получить доступ\nref:zapoinovai[.cid][.asid][.adid]`
 * Partner short-links (/p/:slug) inject cid=<utm_source> so the message becomes
 * `ref:zapoinovai.yuriy` — we map that token to a CRM source label.
 */

/** utm_source / cid token → canonical CRM `leads.source` */
export const PARTNER_SOURCE_ALIASES: Record<string, string> = {
  yuriy: "yuriy",
  dastan: "dastan",
  nadi: "nadi",
  astana_hub: "astana_hub",
  hub: "astana_hub",
  vit: "виталя",
  vitalya: "виталя",
  vitaly: "виталя",
  "виталя": "виталя",
};

/** Sources we may overwrite when a partner ref is found in the first WA message. */
const GENERIC_SOURCES = new Set([
  "",
  "whatsapp",
  "wa",
  "zapoinovai",
  "site",
  "web",
  "website",
  "landing",
  "form",
  "tilda",
  "unknown",
]);

export function canonicalizePartnerSource(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return PARTNER_SOURCE_ALIASES[v] ?? null;
}

/**
 * Extract partner CRM source from inbound WhatsApp text.
 * Ignores numeric Meta campaign/adset/ad ids in the ref chain.
 */
export function partnerSourceFromWhatsAppText(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;

  // ref:zapoinovai.yuriy  or  ref:zapoinovai.yuriy.123.456
  const ref = t.match(/ref\s*:\s*([^\s\n]+)/i);
  if (ref?.[1]) {
    const parts = ref[1].split(".").map((p) => p.trim()).filter(Boolean);
    // skip site token (zapoinovai); take first non-numeric segment
    for (let i = 1; i < parts.length; i++) {
      const tok = parts[i];
      if (/^\d{5,}$/.test(tok)) continue; // Meta id
      const hit = canonicalizePartnerSource(tok);
      if (hit) return hit;
    }
    // also allow ref:yuriy (without site prefix)
    if (parts.length === 1) {
      const hit = canonicalizePartnerSource(parts[0]);
      if (hit) return hit;
    }
  }

  const utm = t.match(/utm_source\s*=\s*([a-zA-Z][\w-]{1,40})/i);
  if (utm?.[1]) {
    const hit = canonicalizePartnerSource(utm[1]);
    if (hit) return hit;
  }

  return null;
}

export function isGenericLeadSource(source: string | null | undefined): boolean {
  return GENERIC_SOURCES.has((source ?? "").trim().toLowerCase());
}
