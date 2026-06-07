import { describe, it, expect } from "vitest";
import { mapMetaCreativesToReport } from "@/hooks/useReportData";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const mk = (over: Partial<MetaCreativeRow> = {}): MetaCreativeRow => ({
  id: over.id ?? "1",
  adId: over.adId ?? "ad-1",
  campaignId: over.campaignId ?? null,
  cabinetId: over.cabinetId ?? "cab-1",
  name: over.name ?? "Creative A",
  creativeType: "video",
  thumbnailUrl: null,
  imageUrl: null,
  posterUrl: null,
  videoUrl: null,
  videoId: null,
  primaryText: null,
  headline: null,
  cta: null,
  destinationUrl: null,
  effectiveStatus: null,
  spend: over.spend ?? 0,
  impressions: over.impressions ?? 0,
  clicks: over.clicks ?? 0,
  leads: over.leads ?? 0,
  messages: 0,
  purchases: 0,
  revenue: 0,
  ctr: over.ctr ?? 0,
  cpl: 0,
  cpc: 0,
  cpm: 0,
  romi: 0,
  crmLeads: over.crmLeads ?? 0,
  crmQualified: 0,
  crmSales: over.crmSales ?? 0,
  crmRevenue: over.crmRevenue ?? 0,
  crmCpl: 0,
  crmCps: 0,
  crmAvgCheck: 0,
  crmRomi: 0,
  crmProfit: 0,
});

describe("mapMetaCreativesToReport", () => {
  it("сортирует по выручке CRM и берёт топ", () => {
    const rows = [
      mk({ adId: "a", name: "Low", spend: 10_000, crmRevenue: 0 }),
      mk({ adId: "b", name: "Top", spend: 5_000, crmRevenue: 10_000, leads: 2 }),
      mk({ adId: "c", name: "Mid", spend: 8_000, crmRevenue: 3_000 }),
    ];
    const out = mapMetaCreativesToReport(rows, "all", 2);
    expect(out).toHaveLength(2);
    expect(out[0].adId).toBe("b");
    expect(out[0].crmRevenue).toBe(10_000);
    expect(out[1].adId).toBe("c");
  });

  it("фильтрует по кабинету", () => {
    const rows = [
      mk({ adId: "a", cabinetId: "cab-1", spend: 1000 }),
      mk({ adId: "b", cabinetId: "cab-2", spend: 2000 }),
    ];
    const out = mapMetaCreativesToReport(rows, "cab-2");
    expect(out).toHaveLength(1);
    expect(out[0].adId).toBe("b");
  });
});
