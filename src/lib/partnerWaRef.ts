/**
 * Partner attribution from WhatsApp prefilled messages (zapoinovai landing).
 * Keep in sync with supabase/functions/_lib/partnerSource.ts
 */

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

export function partnerSourceFromWhatsAppText(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;

  const ref = t.match(/ref\s*:\s*([^\s\n]+)/i);
  if (ref?.[1]) {
    const parts = ref[1].split(".").map((p) => p.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const tok = parts[i];
      if (/^\d{5,}$/.test(tok)) continue;
      const hit = canonicalizePartnerSource(tok);
      if (hit) return hit;
    }
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
