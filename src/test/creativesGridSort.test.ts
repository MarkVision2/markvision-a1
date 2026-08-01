import { describe, expect, it } from "vitest";
import { compareCreatives, creativeSortValue } from "@/lib/creativesGridSort";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const mk = (over: Partial<MetaCreativeRow>): MetaCreativeRow =>
  ({
    id: over.id ?? over.adId ?? "1",
    adId: over.adId ?? "ad",
    campaignId: null,
    cabinetId: null,
    name: over.name ?? "",
    creativeType: "image",
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
    impressions: 0,
    clicks: 0,
    leads: over.leads ?? 0,
    messages: 0,
    purchases: 0,
    revenue: 0,
    ctr: 0,
    cpl: 0,
    cpc: 0,
    cpm: 0,
    romi: 0,
    crmLeads: over.crmLeads ?? 0,
    crmQualified: 0,
    crmSales: over.crmSales ?? 0,
    crmDiagnostics: 0,
    crmRevenue: over.crmRevenue ?? 0,
    crmCpl: 0,
    crmCps: 0,
    crmAvgCheck: 0,
    crmRomi: 0,
    crmProfit: 0,
  }) as MetaCreativeRow;

describe("creativesGridSort", () => {
  it("crmLeads: primary — только CRM, Meta не подменяет", () => {
    const withCrm = mk({ adId: "crm", crmLeads: 3, leads: 3, spend: 1000 });
    const metaOnly = mk({ adId: "meta", crmLeads: 0, leads: 8, spend: 500 });
    expect(creativeSortValue(withCrm, "crmLeads")).toBe(3);
    expect(creativeSortValue(metaOnly, "crmLeads")).toBe(0);
    expect(compareCreatives(withCrm, metaOnly, "crmLeads")).toBeLessThan(0); // withCrm выше
  });

  it("crmLeads: топ сортирует CRM выше Meta-only", () => {
    const rows = [
      mk({ adId: "meta8", crmLeads: 0, leads: 8, spend: 5000 }),
      mk({ adId: "crm3", crmLeads: 3, leads: 3, spend: 2000 }),
      mk({ adId: "crm2", crmLeads: 2, leads: 5, spend: 3000 }),
      mk({ adId: "crm3b", crmLeads: 3, leads: 1, spend: 1000 }),
    ];
    const sorted = [...rows].sort((a, b) => compareCreatives(a, b, "crmLeads"));
    expect(sorted.map((r) => r.adId)).toEqual(["crm3", "crm3b", "crm2", "meta8"]);
  });

  it("crmLeads: при равных CRM — Meta leads, затем spend", () => {
    const a = mk({ adId: "a", crmLeads: 2, leads: 1, spend: 9000 });
    const b = mk({ adId: "b", crmLeads: 2, leads: 4, spend: 1000 });
    expect(compareCreatives(a, b, "crmLeads")).toBeGreaterThan(0); // b выше
  });
});
