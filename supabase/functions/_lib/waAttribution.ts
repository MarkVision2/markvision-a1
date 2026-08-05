/**
 * WhatsApp → CRM attribution helpers shared by greenapi-webhook and wa-web-bridge.
 *
 * Sources of truth (priority):
 * 1. CTWA / externalAdReply / referral payload (Meta Click-to-WhatsApp)
 * 2. Prefill text: ref:zapoinovai[.partner][.campaign][.adset][.ad] + utm_*
 * 3. Sticky phone_attribution / wa_clicks by phone
 */
import {
  canonicalizePartnerSource,
  isGenericLeadSource,
  partnerSourceFromWhatsAppText,
} from "./partnerSource.ts";

export interface CtwaAttribution {
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  click_id: string | null;
  headline: string | null;
}

export interface WaTextAttribution {
  partnerSource: string | null;
  site: string | null;
  utm: Record<string, string>;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  click_id: string | null;
}

export function emptyCtwa(): CtwaAttribution {
  return {
    meta_ad_id: null,
    meta_adset_id: null,
    meta_campaign_id: null,
    click_id: null,
    headline: null,
  };
}

function tryExtractAdFromUrl(u: unknown): string | null {
  if (!u || typeof u !== "string") return null;
  const m1 = u.match(/[?&](?:ad_id|adId|content)=([0-9]{6,})/);
  if (m1) return m1[1];
  const m2 = u.match(/fb\.me\/([0-9]{6,})/);
  if (m2) return m2[1];
  return null;
}

function pushCandidate(out: Record<string, unknown>[], v: unknown) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    out.push(v as Record<string, unknown>);
  }
}

/** Best-effort Meta CTWA parser (Green API + Baileys-shaped payloads). */
export function parseCtwaPayload(
  messageData: Record<string, unknown> | undefined | null,
  body: Record<string, unknown> = {},
): CtwaAttribution {
  const out = emptyCtwa();
  if (!messageData && !body) return out;

  const candidates: Record<string, unknown>[] = [];
  if (messageData) {
    pushCandidate(candidates, messageData);
    const ext = messageData.extendedTextMessageData as Record<string, unknown> | undefined;
    pushCandidate(candidates, ext);
    pushCandidate(candidates, messageData.contextInfo ?? messageData.context_info);
    pushCandidate(candidates, messageData.externalAdReply ?? messageData.external_ad_reply);
    pushCandidate(candidates, messageData.referral ?? messageData.referralData);
    pushCandidate(candidates, ext?.referral);
    pushCandidate(candidates, ext?.externalAdReply ?? ext?.external_ad_reply);
    const ctx = (messageData.contextInfo ?? messageData.context_info) as
      | Record<string, unknown>
      | undefined;
    if (ctx) {
      pushCandidate(candidates, ctx.referral);
      pushCandidate(candidates, ctx.externalAdReply ?? ctx.external_ad_reply);
    }
    const quoted = (messageData.quotedMessage ?? messageData.quoted_message) as
      | Record<string, unknown>
      | undefined;
    if (quoted) {
      const qctx = (quoted.contextInfo ?? quoted.context_info) as
        | Record<string, unknown>
        | undefined;
      pushCandidate(candidates, qctx);
      if (qctx) {
        pushCandidate(candidates, qctx.externalAdReply ?? qctx.external_ad_reply);
      }
    }
  }
  pushCandidate(candidates, body.referralData ?? body.referral);
  pushCandidate(candidates, body.senderData);
  pushCandidate(candidates, body.attribution);
  pushCandidate(candidates, body.ctwa);
  pushCandidate(candidates, body.externalAdReply);

  for (const c of candidates) {
    const sourceId = c.sourceId ?? c.source_id ?? c.adId ?? c.ad_id;
    if (sourceId && !out.meta_ad_id) out.meta_ad_id = String(sourceId);
    const ctwa = c.ctwaClid ?? c.ctwa_clid ?? c.clickId ?? c.click_id;
    if (ctwa && !out.click_id) out.click_id = String(ctwa);
    const camp = c.campaignId ?? c.campaign_id;
    if (camp && !out.meta_campaign_id) out.meta_campaign_id = String(camp);
    const adset = c.adsetId ?? c.adset_id;
    if (adset && !out.meta_adset_id) out.meta_adset_id = String(adset);
    const headline = c.headline ?? c.title;
    if (headline && !out.headline) out.headline = String(headline);
    if (!out.meta_ad_id) {
      const fromUrl = tryExtractAdFromUrl(c.sourceUrl ?? c.source_url ?? c.url);
      if (fromUrl) out.meta_ad_id = fromUrl;
    }
  }
  return out;
}

function pickUtm(text: string, key: string): string | null {
  const re = new RegExp(
    `(?:^|[?&#\\s])${key}\\s*=\\s*([^\\s&#\\n]+)`,
    "i",
  );
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

/**
 * Parse prefilled WA text (landing / wa.me) into partner + UTM + Meta ids.
 * `ref:zapoinovai[.partner|.cid][.asid][.adid]`
 */
export function attributionFromWhatsAppText(
  text: string | null | undefined,
): WaTextAttribution {
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
    // Templates often use utm_content={{ad.id}} or "{{ad.id}}_{{ad.name}}"
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

  // Short click tokens sometimes appended as #abc12 or [#abc12]
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

export function mergeCtwa(
  primary: CtwaAttribution | null | undefined,
  fallback: CtwaAttribution | null | undefined,
): CtwaAttribution {
  const a = primary ?? emptyCtwa();
  const b = fallback ?? emptyCtwa();
  return {
    meta_ad_id: a.meta_ad_id || b.meta_ad_id,
    meta_adset_id: a.meta_adset_id || b.meta_adset_id,
    meta_campaign_id: a.meta_campaign_id || b.meta_campaign_id,
    click_id: a.click_id || b.click_id,
    headline: a.headline || b.headline,
  };
}

export function ctwaFromTextAttr(textAttr: WaTextAttribution): CtwaAttribution {
  return {
    meta_ad_id: textAttr.meta_ad_id,
    meta_adset_id: textAttr.meta_adset_id,
    meta_campaign_id: textAttr.meta_campaign_id,
    click_id: textAttr.click_id,
    headline: null,
  };
}

export function resolveLeadSourceLabel(
  attribution: CtwaAttribution | null | undefined,
  partnerSource: string | null | undefined,
  textAttr?: WaTextAttribution | null,
): string {
  if (attribution?.meta_ad_id) return "meta";
  if (partnerSource?.trim()) return partnerSource.trim();
  if (textAttr?.site === "zapoinovai") return "zapoinovai";
  return "whatsapp";
}

export { isGenericLeadSource, partnerSourceFromWhatsAppText };
