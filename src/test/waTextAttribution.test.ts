import { describe, expect, it } from "vitest";
import { attributionFromWhatsAppText } from "@/lib/waTextAttribution";

describe("attributionFromWhatsAppText", () => {
  it("читает Meta ids из ref:zapoinovai.campaign.adset.ad", () => {
    const a = attributionFromWhatsAppText(
      "Хочу получить доступ\nref:zapoinovai.120111.120222.120333",
    );
    expect(a.site).toBe("zapoinovai");
    expect(a.meta_campaign_id).toBe("120111");
    expect(a.meta_adset_id).toBe("120222");
    expect(a.meta_ad_id).toBe("120333");
    expect(a.utm.source).toBe("meta");
    expect(a.utm.ad_id).toBe("120333");
  });

  it("читает партнёра + ad id", () => {
    const a = attributionFromWhatsAppText("ref:zapoinovai.yuriy.120333");
    expect(a.partnerSource).toBe("yuriy");
    expect(a.meta_ad_id).toBe("120333");
  });

  it("читает utm_content={{ad.id}}_name", () => {
    const a = attributionFromWhatsAppText(
      "utm_source=meta&utm_medium=paid&utm_campaign=120111&utm_content=120333_Creative&utm_term=120222",
    );
    expect(a.meta_ad_id).toBe("120333");
    expect(a.meta_adset_id).toBe("120222");
    expect(a.meta_campaign_id).toBe("120111");
    expect(a.utm.source).toBe("meta");
  });
});
