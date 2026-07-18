import { describe, expect, it } from "vitest";
import {
  aggregateProjectCrmTotals,
  aggregateCreativeCrmFromLeads,
} from "@/lib/creativeCrmMetrics";
import {
  buildCreativeDecisionSummary,
  classifyCreativeDecision,
  dedupMetaCreatives,
  metaLeadCount,
  sortCreativeRows,
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

  it("classifies profitable creatives as scale candidates", () => {
    const decision = classifyCreativeDecision(
      baseRow({ spend: 100_000, crmSales: 3, crmRevenue: 500_000, crmProfit: 400_000, crmRomi: 400 }),
    );
    expect(decision.key).toBe("scale");
    expect(decision.tone).toBe("success");
  });

  it("does not recommend scaling when spend data is missing", () => {
    const decision = classifyCreativeDecision(
      baseRow({ spend: 0, crmSales: 2, crmRevenue: 500_000, crmProfit: 500_000 }),
    );
    expect(decision.key).not.toBe("scale");
  });

  it("distinguishes attribution gaps, funnel leaks and no-result spend", () => {
    expect(classifyCreativeDecision(baseRow({ spend: 50_000, leads: 10, crmLeads: 0 })).key)
      .toBe("attribution_gap");
    expect(classifyCreativeDecision(baseRow({ spend: 50_000, leads: 10, crmLeads: 5, crmSales: 0 })).key)
      .toBe("funnel_leak");
    expect(classifyCreativeDecision(baseRow({ spend: 50_000, leads: 0, messages: 0, crmLeads: 0 })).key)
      .toBe("no_results");
  });

  it("builds decision summary with attribution coverage and risk spend", () => {
    const summary = buildCreativeDecisionSummary(
      [
        baseRow({ id: "winner", spend: 100_000, leads: 8, crmLeads: 6, crmSales: 2, crmRevenue: 400_000, crmProfit: 300_000, crmRomi: 300 }),
        baseRow({ id: "gap", videoUrl: "https://cdn.example/gap.mp4", spend: 30_000, leads: 5, crmLeads: 0 }),
        baseRow({ id: "leak", videoUrl: "https://cdn.example/leak.mp4", spend: 20_000, leads: 4, crmLeads: 3, crmSales: 0 }),
      ],
      12,
    );
    expect(summary.spend).toBe(150_000);
    expect(summary.revenue).toBe(400_000);
    expect(summary.profit).toBe(250_000);
    expect(summary.winners).toBe(1);
    expect(summary.attributedCrmLeads).toBe(9);
    expect(summary.unattributedCrmLeads).toBe(3);
    expect(summary.attributionCoverage).toBe(75);
    expect(summary.riskSpend).toBe(50_000);
    expect(summary.bestCreative?.id).toBe("winner");
  });

  it("sorts numeric metrics in the requested direction and keeps empty CPL last", () => {
    const rows = [
      baseRow({ id: "a", name: "A", crmRevenue: 100, crmCpl: 10 }),
      baseRow({ id: "b", videoUrl: "https://cdn.example/b.mp4", name: "B", crmRevenue: 300, cpl: 0 }),
      baseRow({ id: "c", videoUrl: "https://cdn.example/c.mp4", name: "C", crmRevenue: 200, crmCpl: 5 }),
    ];
    expect(sortCreativeRows(rows, "crmRevenue", "desc").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortCreativeRows(rows, "crmRevenue", "asc").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(sortCreativeRows(rows, "cpl", "asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
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
