import type { Lead, UtmTags } from "@/types/crm";

export type MetaAttributionIds = {
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
};

const META_ID_RE = /^[0-9]{6,}$/;

function clean(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function numericId(value: unknown): string | null {
  const text = clean(value);
  return text && META_ID_RE.test(text) ? text : null;
}

export function deriveMetaAttributionIds(input: {
  utm?: UtmTags | null;
  metaAdId?: string | null;
  metaAdsetId?: string | null;
  metaCampaignId?: string | null;
}): MetaAttributionIds {
  const utm = input.utm ?? {};
  return {
    adId: clean(input.metaAdId) ?? numericId(utm.ad_id) ?? numericId(utm.content),
    adsetId: clean(input.metaAdsetId) ?? numericId(utm.adset_id) ?? numericId(utm.term),
    campaignId: clean(input.metaCampaignId) ?? numericId(utm.campaign_id) ?? numericId(utm.campaign),
  };
}

export function hasMetaAttribution(input: Pick<Lead, "utm" | "metaAdId" | "metaAdsetId" | "metaCampaignId">): boolean {
  const ids = deriveMetaAttributionIds(input);
  return !!(ids.adId || ids.adsetId || ids.campaignId);
}

export function campaignHint(utm?: UtmTags | null): string | null {
  return clean(utm?.campaign) ?? clean(utm?.campaign_id) ?? null;
}

export function adHint(utm?: UtmTags | null): string | null {
  return clean(utm?.content) ?? clean(utm?.ad_id) ?? null;
}
