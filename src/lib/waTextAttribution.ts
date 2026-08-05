/**
 * Parse WhatsApp prefilled text for CRM attribution (keep in sync with
 * supabase/functions/_lib/waAttribution.ts).
 */
import { canonicalizePartnerSource, partnerSourceFromWhatsAppText } from "@/lib/partnerWaRef";

export type WaTextAttribution = {
  partnerSource: string | null;
  site: string | null;
  utm: Record<string, string>;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  click_id: string | null;
};

function pickUtm(text: string, key: string): string | null {
  const re = new RegExp(`(?:^|[?&#\\s])${key}\\s*=\\s*([^\\s&#\\n]+)`, "i");
  const m = text.match(re);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " ")).trim() || null;
  } catch {
    return m[1].trim() || null;
  }
}

function isMetaNumericId(v: string | null | undefined): v is string {
  return !!v && /^[0-9]{6,}$/.test(v);
}

export function attributionFromWhatsAppText(text: string | null | undefined): WaTextAttribution {
  const t = (text ?? "").trim();
  const out: WaTextAttribution = {
    partnerSource: partnerSourceFromWhatsAppText(t),
    site: null,
    utm: {},
    meta_ad_id: null,
    meta_adset_id: null,
    meta_campaign_id: null,
    click_id: null,
  };
  if (!t) return out;

  const ref = t.match(/ref\s*:\s*([^\s\n]+)/i);
  if (ref?.[1]) {
    const parts = ref[1].split(".").map((p) => p.trim()).filter(Boolean);
    if (parts[0]?.toLowerCase() === "zapoinovai") {
      out.site = "zapoinovai";
      out.utm.site = "zapoinovai";
    }
    const numerics: string[] = [];
    for (let i = parts[0]?.toLowerCase() === "zapoinovai" ? 1 : 0; i < parts.length; i++) {
      const tok = parts[i];
      if (isMetaNumericId(tok)) numerics.push(tok);
      else if (!out.partnerSource) {
        const hit = canonicalizePartnerSource(tok);
        if (hit) out.partnerSource = hit;
      }
    }
    if (numerics.length >= 3) {
      out.meta_campaign_id = numerics[numerics.length - 3];
      out.meta_adset_id = numerics[numerics.length - 2];
      out.meta_ad_id = numerics[numerics.length - 1];
    } else if (numerics.length === 2) {
      out.meta_adset_id = numerics[0];
      out.meta_ad_id = numerics[1];
    } else if (numerics.length === 1) {
      out.meta_ad_id = numerics[0];
    }
  }

  const utmSource = pickUtm(t, "utm_source");
  const utmMedium = pickUtm(t, "utm_medium");
  const utmCampaign = pickUtm(t, "utm_campaign");
  const utmContent = pickUtm(t, "utm_content");
  const utmTerm = pickUtm(t, "utm_term");
  if (utmSource) out.utm.source = utmSource;
  if (utmMedium) out.utm.medium = utmMedium;
  if (utmCampaign) out.utm.campaign = utmCampaign;
  if (utmContent) {
    out.utm.content = utmContent;
    const adFromContent = utmContent.match(/^([0-9]{6,})/);
    if (adFromContent && !out.meta_ad_id) out.meta_ad_id = adFromContent[1];
  }
  if (utmTerm) {
    out.utm.term = utmTerm;
    if (isMetaNumericId(utmTerm) && !out.meta_adset_id) out.meta_adset_id = utmTerm;
  }
  if (isMetaNumericId(utmCampaign) && !out.meta_campaign_id) {
    out.meta_campaign_id = utmCampaign;
  }

  if (!out.partnerSource && utmSource) {
    out.partnerSource = canonicalizePartnerSource(utmSource);
  }

  const clickTok = t.match(/\[?#([a-zA-Z0-9_-]{4,32})\]?/);
  if (clickTok?.[1] && !out.click_id) out.click_id = clickTok[1];
  const fbclid = pickUtm(t, "fbclid");
  if (fbclid && !out.click_id) out.click_id = fbclid;

  if (out.partnerSource) out.utm.source = out.utm.source || out.partnerSource;
  else if (out.site === "zapoinovai" && !out.utm.source) out.utm.source = "meta";
  else if (out.meta_ad_id && !out.utm.source) out.utm.source = "meta";

  if (out.meta_ad_id) out.utm.ad_id = out.meta_ad_id;
  if (out.meta_adset_id) out.utm.adset_id = out.meta_adset_id;
  if (out.meta_campaign_id) out.utm.campaign_id = out.meta_campaign_id;

  return out;
}
