import { describe, expect, it } from "vitest";
import { buildCreativesSummary } from "@/lib/creativesOverview";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

function creative(partial: Partial<MetaCreativeRow> & Pick<MetaCreativeRow, "id" | "adId" | "name">): MetaCreativeRow {
  return {
    campaignId: null,
    cabinetId: null,
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
    effectiveStatus: "ACTIVE",
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    messages: 0,
    purchases: 0,
    revenue: 0,
    ctr: 0,
    cpl: 0,
    cpc: 0,
    cpm: 0,
    romi: 0,
    crmLeads: 0,
    crmQualified: 0,
    crmSales: 0,
    crmDiagnostics: 0,
    crmRevenue: 0,
    crmCpl: 0,
    crmCps: 0,
    crmAvgCheck: 0,
    crmRomi: 0,
    crmProfit: 0,
    ...partial,
  };
}

describe("buildCreativesSummary", () => {
  const rows = [
    creative({
      id: "1",
      adId: "a1",
      name: "Лучший",
      spend: 100_000,
      leads: 20,
      messages: 5,
      crmRevenue: 400_000,
      crmSales: 4,
      crmRomi: 300,
    }),
    creative({
      id: "2",
      adId: "a2",
      name: "Паузнутый",
      effectiveStatus: "PAUSED",
      spend: 50_000,
      leads: 5,
    }),
    creative({ id: "3", adId: "a3", name: "Пустой", effectiveStatus: "PAUSED" }),
  ];

  it("aggregates spend, results and CRM revenue", () => {
    const summary = buildCreativesSummary(rows);
    expect(summary.total).toBe(3);
    expect(summary.active).toBe(1);
    expect(summary.spend).toBe(150_000);
    expect(summary.results).toBe(25);
    expect(summary.crmRevenue).toBe(400_000);
    expect(summary.crmProfit).toBe(250_000);
  });

  it("does not double-count WhatsApp messages already inside leads", () => {
    const summary = buildCreativesSummary([
      creative({ id: "wa", adId: "wa1", name: "WA", leads: 5, messages: 5, spend: 1000 }),
    ]);
    expect(summary.results).toBe(5);
  });

  it("picks the best creative by CRM ROMI with spend", () => {
    const summary = buildCreativesSummary(rows);
    expect(summary.best?.id).toBe("1");
  });

  it("returns null best when nothing has CRM revenue", () => {
    const summary = buildCreativesSummary([rows[1], rows[2]]);
    expect(summary.best).toBeNull();
  });
});
