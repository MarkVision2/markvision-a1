import { describe, expect, it } from "vitest";
import { adHint, campaignHint, deriveMetaAttributionIds, hasMetaAttribution } from "@/lib/metaAttribution";

describe("metaAttribution", () => {
  it("derives Meta ids from standard UTM template", () => {
    const ids = deriveMetaAttributionIds({
      utm: {
        source: "meta",
        campaign: "120212345678900001",
        term: "120212345678900002",
        content: "120212345678900003",
      },
    });

    expect(ids).toEqual({
      campaignId: "120212345678900001",
      adsetId: "120212345678900002",
      adId: "120212345678900003",
    });
  });

  it("derives Meta ids from n8n/zapoinovai UTM extras", () => {
    const ids = deriveMetaAttributionIds({
      utm: {
        source: "meta",
        campaign_id: "120200000000000001",
        adset_id: "120200000000000002",
        ad_id: "120200000000000003",
      },
    });

    expect(ids).toEqual({
      campaignId: "120200000000000001",
      adsetId: "120200000000000002",
      adId: "120200000000000003",
    });
  });

  it("prefers explicit lead meta columns over UTM values", () => {
    const ids = deriveMetaAttributionIds({
      metaCampaignId: "120299999999999991",
      metaAdsetId: "120299999999999992",
      metaAdId: "120299999999999993",
      utm: {
        campaign: "120200000000000001",
        term: "120200000000000002",
        content: "120200000000000003",
      },
    });

    expect(ids).toEqual({
      campaignId: "120299999999999991",
      adsetId: "120299999999999992",
      adId: "120299999999999993",
    });
  });

  it("keeps readable UTM hints for non-numeric campaign names", () => {
    const utm = { campaign: "summer_diagnostics", content: "creative_a" };

    expect(hasMetaAttribution({ utm, metaAdId: null, metaAdsetId: null, metaCampaignId: null })).toBe(false);
    expect(campaignHint(utm)).toBe("summer_diagnostics");
    expect(adHint(utm)).toBe("creative_a");
  });
});
