import { describe, expect, it } from "vitest";
import {
  buildReportExecutive,
  type ReportExecutiveInput,
} from "@/lib/reportExecutive";
import type { ReportData, ReportTotals } from "@/hooks/useReportData";

const totals = (patch: Partial<ReportTotals> = {}): ReportTotals => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  adsLeads: 0,
  crmLeads: 0,
  totalLeads: 0,
  visits: 0,
  sales: 0,
  revenue: 0,
  cpl: 0,
  cpv: 0,
  cac: 0,
  ctr: 0,
  romi: 0,
  aov: 0,
  ...patch,
});

function input(patch: Partial<ReportExecutiveInput> = {}): ReportExecutiveInput {
  const data: ReportData = {
    totals: totals(),
    creatives: [],
    channels: [],
    scoring: { hot: 0, warm: 0, cold: 0, hotLeads: 0, warmLeads: 0, coldLeads: 0 },
    monthlyMeta: [],
  };
  return { data, comparing: true, ...patch };
}

describe("buildReportExecutive", () => {
  it("returns no-data status for an empty report", () => {
    const result = buildReportExecutive(input());
    expect(result.status.key).toBe("no_data");
    expect(result.actions[0]?.tone).toBe("info");
    expect(result.dataHealth.score).toBe(0);
  });

  it("marks profitable growth and computes profit", () => {
    const data = input().data;
    data.totals = totals({
      spend: 100_000,
      impressions: 50_000,
      clicks: 1_000,
      adsLeads: 50,
      crmLeads: 45,
      totalLeads: 50,
      visits: 15,
      sales: 5,
      revenue: 600_000,
      romi: 500,
    });
    data.prev = totals({ spend: 90_000, totalLeads: 40, sales: 3, revenue: 300_000 });

    const result = buildReportExecutive(input({ data }));
    expect(result.status.key).toBe("growth");
    expect(result.profit).toBe(500_000);
    expect(result.deltas.revenue).toBe(100);
    expect(result.deltas.sales).toBeCloseTo(66.666, 2);
  });

  it("flags spend without confirmed revenue", () => {
    const data = input().data;
    data.totals = totals({
      spend: 150_000,
      impressions: 30_000,
      clicks: 600,
      totalLeads: 30,
      crmLeads: 25,
      sales: 0,
      revenue: 0,
    });
    const result = buildReportExecutive(input({ data }));
    expect(result.status.key).toBe("attention");
    expect(result.actions.some((a) => a.key === "revenue_missing")).toBe(true);
  });

  it("finds the weakest business conversion step", () => {
    const data = input().data;
    data.totals = totals({
      spend: 100_000,
      impressions: 100_000,
      clicks: 500,
      totalLeads: 100,
      visits: 10,
      sales: 5,
      revenue: 250_000,
    });
    const result = buildReportExecutive(input({ data }));
    expect(result.bottleneck?.key).toBe("lead_to_visit");
    expect(result.bottleneck?.conversion).toBe(10);
  });

  it("reports creative attribution coverage and channel concentration", () => {
    const data = input().data;
    data.totals = totals({
      spend: 100_000,
      impressions: 50_000,
      clicks: 1_000,
      totalLeads: 20,
      crmLeads: 20,
      sales: 2,
      revenue: 300_000,
    });
    data.creatives = [
      {
        adId: "ad-1",
        name: "Winner",
        spend: 50_000,
        impressions: 20_000,
        clicks: 500,
        ctr: 2.5,
        leads: 10,
        crmLeads: 8,
        crmSales: 2,
        crmRevenue: 300_000,
        crmRomi: 500,
        creativeType: "video",
        thumbnailUrl: null,
        imageUrl: null,
        posterUrl: null,
        videoUrl: null,
      },
    ];
    data.channels = [
      { name: "WhatsApp", leads: 16, share: 80 },
      { name: "Сайт", leads: 4, share: 20 },
    ];

    const result = buildReportExecutive(input({ data }));
    expect(result.dataHealth.creativeAttribution).toBe(40);
    expect(result.actions.some((a) => a.key === "channel_concentration")).toBe(true);
    expect(result.bestCreative?.adId).toBe("ad-1");
  });

  it("hides period deltas when comparison is disabled", () => {
    const data = input().data;
    data.totals = totals({ spend: 100, revenue: 200 });
    data.prev = totals({ spend: 50, revenue: 100 });
    const result = buildReportExecutive(input({ data, comparing: false }));
    expect(result.deltas.revenue).toBeNull();
    expect(result.deltas.spend).toBeNull();
  });
});
