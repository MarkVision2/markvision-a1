import { describe, expect, it } from "vitest";
import {
  aggregateProjectCrmTotals,
  aggregateCreativeCrmFromLeads,
} from "@/lib/creativeCrmMetrics";
import {
  dedupMetaCreatives,
  metaLeadCount,
  sumCreativeTableTotals,
} from "@/lib/creativeFunnelUtils";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const baseRow = (patch: Partial<MetaCreativeRow>): MetaCreativeRow => ({
  id: "1",
  adId: "ad-1",
  campaignId: null,
  cabinetId: null,
  name: "Test",
  creativeType: "video",
  thumbnailUrl: null,
  imageUrl: null,
  posterUrl: null,
  videoUrl: "https://cdn.example/v.mp4",
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
  ...patch,
});

describe("creativeFunnelUtils", () => {
  it("metaLeadCount prefers messages for WA", () => {
    expect(metaLeadCount({ leads: 2, messages: 9 })).toBe(9);
    expect(metaLeadCount({ leads: 5, messages: 0 })).toBe(5);
  });

  it("dedupMetaCreatives sums metrics and keeps merged ad ids", () => {
    const merged = dedupMetaCreatives([
      baseRow({ adId: "ad-1", spend: 1000, crmLeads: 2, crmRevenue: 50000 }),
      baseRow({ id: "2", adId: "ad-2", spend: 500, crmLeads: 1, crmRevenue: 10000 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.spend).toBe(1500);
    expect(merged[0]?.crmLeads).toBe(3);
    expect(merged[0]?.mergedAdIds).toEqual(["ad-1", "ad-2"]);
  });

  it("sumCreativeTableTotals aggregates filtered rows", () => {
    const totals = sumCreativeTableTotals([
      baseRow({ spend: 1000, leads: 1, messages: 3, crmLeads: 2 }),
      baseRow({ spend: 2000, leads: 4, messages: 0, crmLeads: 1 }),
    ]);
    expect(totals.spend).toBe(3000);
    expect(totals.metaLeads).toBe(7);
    expect(totals.crmLeads).toBe(3);
  });
});

describe("aggregateProjectCrmTotals", () => {
  const range = { from: new Date("2026-06-01"), to: new Date("2026-06-30") };

  it("не считает оплату как диагностику", () => {
    const totals = aggregateProjectCrmTotals(
      [
        {
          createdAt: "2026-06-05T10:00:00Z",
          paidAt: "2026-06-10T12:00:00Z",
          stageKey: "paid",
          amount: 100_000,
          diagnosticAmount: 0,
          paid: true,
        },
      ],
      range,
    );
    expect(totals.sales).toBe(1);
    expect(totals.diagnostics).toBe(0);
    expect(totals.revenue).toBe(100_000);
  });

  it("согласуется с aggregateCreativeCrmFromLeads по выручке", () => {
    const leads = [
      {
        metaAdId: "ad-1",
        createdAt: "2026-06-05T10:00:00Z",
        stageKey: "visit",
        diagnosticAmount: 10_000,
        paid: false,
        lastActivityAt: "2026-06-10T12:00:00Z",
      },
    ];
    const perAd = aggregateCreativeCrmFromLeads(leads, range);
    const project = aggregateProjectCrmTotals(leads, range);
    expect(project.revenue).toBe(perAd.get("ad-1")?.crmRevenue);
    expect(project.diagnostics).toBe(1);
  });
});
