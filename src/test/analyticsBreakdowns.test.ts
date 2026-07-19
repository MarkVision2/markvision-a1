import { describe, expect, it } from "vitest";
import {
  buildAnalyticsInsights,
  buildSiteBreakdown,
  buildSourceBreakdown,
  siteDomain,
  sourceLabel,
} from "@/lib/analyticsBreakdowns";
import type { LeadLite } from "@/hooks/useLeadsLite";
import type { ChannelStat } from "@/components/analytics/ChannelCard";
import { CHANNELS } from "@/lib/channelAttribution";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

function lead(partial: Partial<LeadLite> & Pick<LeadLite, "id" | "createdAt">): LeadLite {
  return {
    projectId: null,
    source: "whatsapp",
    channel: null,
    referrer: null,
    landingUrl: null,
    utm: null,
    metaAdId: null,
    cabinetId: null,
    stageKey: "new",
    amount: 0,
    diagnosticAmount: 0,
    paidAt: null,
    lastActivityAt: partial.createdAt,
    firstResponseAt: null,
    assigneeId: null,
    paid: false,
    aiScore: 0,
    scoreLabel: null,
    rejectReason: null,
    rejectedAt: null,
    stageId: null,
    nextVisitAt: null,
    paymentMethod: null,
    ...partial,
  };
}

const JULY = {
  from: new Date(2026, 6, 1).getTime(),
  to: new Date(2026, 7, 1).getTime(),
};

describe("sourceLabel", () => {
  it("maps raw source values to human labels", () => {
    expect(sourceLabel("whatsapp")).toBe("WhatsApp");
    expect(sourceLabel("wa")).toBe("WhatsApp");
    expect(sourceLabel("instagram")).toBe("Instagram");
    expect(sourceLabel("meta")).toBe("Реклама Meta");
    expect(sourceLabel("")).toBe("Без источника");
    expect(sourceLabel(null)).toBe("Без источника");
    expect(sourceLabel("Своя CRM")).toBe("Своя CRM");
  });
});

describe("buildSourceBreakdown", () => {
  const leads: LeadLite[] = [
    lead({ id: "1", createdAt: "2026-07-02T10:00:00Z", source: "whatsapp", aiScore: 80 }),
    lead({ id: "2", createdAt: "2026-07-03T10:00:00Z", source: "whatsapp" }),
    lead({
      id: "3", createdAt: "2026-07-05T10:00:00Z", source: "whatsapp",
      paid: true, paidAt: "2026-07-10T10:00:00Z", amount: 500_000, stageKey: "paid",
    }),
    lead({ id: "4", createdAt: "2026-07-06T10:00:00Z", source: "instagram" }),
    // Лид июня, оплативший в июле: продажа в июле, лид — нет.
    lead({
      id: "5", createdAt: "2026-06-20T10:00:00Z", source: "meta",
      paid: true, paidAt: "2026-07-15T10:00:00Z", amount: 300_000, stageKey: "paid",
    }),
    // Лид августа — вне периода полностью.
    lead({ id: "6", createdAt: "2026-08-01T10:00:00Z", source: "whatsapp" }),
  ];

  it("counts leads by createdAt and sales by paidAt", () => {
    const rows = buildSourceBreakdown(leads, JULY);
    const wa = rows.find((r) => r.label === "WhatsApp")!;
    expect(wa.leads).toBe(3);
    expect(wa.sales).toBe(1);
    expect(wa.revenue).toBe(500_000);
    expect(wa.hot).toBe(1);

    const meta = rows.find((r) => r.label === "Реклама Meta")!;
    expect(meta.leads).toBe(0);
    expect(meta.sales).toBe(1);
    expect(meta.revenue).toBe(300_000);
  });

  it("computes share of period leads and sorts by revenue", () => {
    const rows = buildSourceBreakdown(leads, JULY);
    expect(rows[0].label).toBe("WhatsApp");
    const wa = rows[0];
    expect(Math.round(wa.share)).toBe(75); // 3 из 4 июльских лидов
    expect(wa.cr).toBeCloseTo((1 / 3) * 100);
  });

  it("filters by cabinet when provided", () => {
    const scoped = buildSourceBreakdown(
      [
        lead({ id: "a", createdAt: "2026-07-02T10:00:00Z", cabinetId: "cab-1" }),
        lead({ id: "b", createdAt: "2026-07-02T10:00:00Z", cabinetId: "cab-2" }),
      ],
      { ...JULY, cabinetId: "cab-1" },
    );
    expect(scoped.reduce((s, r) => s + r.leads, 0)).toBe(1);
  });
});

describe("siteDomain", () => {
  it("normalizes URLs to a readable hostname", () => {
    expect(siteDomain("https://www.clinic-a.kz/services?utm_source=meta")).toBe("clinic-a.kz");
    expect(siteDomain("clinic-b.kz/form")).toBe("clinic-b.kz");
    expect(siteDomain(null)).toBe("Сайт не определён");
  });
});

describe("buildSiteBreakdown", () => {
  const leads: LeadLite[] = [
    lead({
      id: "site-1",
      createdAt: "2026-07-02T10:00:00Z",
      landingUrl: "https://www.clinic-a.kz/form?utm_source=meta",
      paid: true,
      paidAt: "2026-07-10T10:00:00Z",
      amount: 450_000,
      stageKey: "paid",
    }),
    lead({
      id: "site-2",
      createdAt: "2026-07-03T10:00:00Z",
      landingUrl: "https://clinic-a.kz/implant",
    }),
    lead({
      id: "site-3",
      createdAt: "2026-07-04T10:00:00Z",
      landingUrl: "https://clinic-b.kz/",
    }),
    lead({
      id: "site-4",
      createdAt: "2026-07-05T10:00:00Z",
      landingUrl: null,
      source: "site",
    }),
    // WhatsApp-лид без landing_url не относится к сайтам и не должен попадать в таблицу.
    lead({ id: "wa-1", createdAt: "2026-07-06T10:00:00Z", source: "whatsapp" }),
  ];

  it("groups leads by normalized site domain", () => {
    const rows = buildSiteBreakdown(leads, JULY);
    const clinicA = rows.find((r) => r.domain === "clinic-a.kz")!;
    expect(clinicA.leads).toBe(2);
    expect(clinicA.sales).toBe(1);
    expect(clinicA.revenue).toBe(450_000);
    expect(clinicA.cr).toBe(50);
    expect(rows.find((r) => r.domain === "clinic-b.kz")?.leads).toBe(1);
    expect(rows.find((r) => r.domain === "Сайт не определён")?.leads).toBe(1);
  });

  it("filters by cabinet", () => {
    const rows = buildSiteBreakdown(
      [
        lead({ id: "a", createdAt: "2026-07-02T10:00:00Z", landingUrl: "https://a.kz", cabinetId: "cab-1" }),
        lead({ id: "b", createdAt: "2026-07-02T10:00:00Z", landingUrl: "https://b.kz", cabinetId: "cab-2" }),
      ],
      { ...JULY, cabinetId: "cab-1" },
    );
    expect(rows.map((r) => r.domain)).toEqual(["a.kz"]);
  });
});

describe("buildAnalyticsInsights", () => {
  const channel = (partial: Partial<ChannelStat>): ChannelStat => ({
    meta: CHANNELS.whatsapp,
    spend: 0, leads: 0, sales: 0, revenue: 0,
    ...partial,
  });

  const creative = (partial: Partial<MetaCreativeRow>): MetaCreativeRow => ({
    id: "c1", adId: "ad1", campaignId: null, cabinetId: null, name: "Видео А",
    creativeType: "video", thumbnailUrl: null, imageUrl: null, posterUrl: null,
    videoUrl: null, videoId: null, primaryText: null, headline: null, cta: null,
    destinationUrl: null, effectiveStatus: "ACTIVE",
    spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0,
    revenue: 0, ctr: 0, cpl: 0, cpc: 0, cpm: 0, romi: 0,
    crmLeads: 0, crmQualified: 0, crmSales: 0, crmDiagnostics: 0, crmRevenue: 0,
    crmCpl: 0, crmCps: 0, crmAvgCheck: 0, crmRomi: 0, crmProfit: 0,
    ...partial,
  });

  it("picks best channel, source and creative", () => {
    const insights = buildAnalyticsInsights({
      channels: [
        channel({ leads: 10, sales: 2, revenue: 800_000 }),
        channel({ meta: CHANNELS.instagram, leads: 20 }),
      ],
      sources: buildSourceBreakdown(
        [lead({ id: "1", createdAt: "2026-07-02T10:00:00Z", source: "whatsapp" })],
        JULY,
      ),
      creatives: [
        creative({ spend: 50_000, crmRevenue: 400_000, crmRomi: 700 }),
        creative({ id: "c2", adId: "ad2", spend: 90_000, crmRevenue: 0 }),
      ],
    });

    const byKind = Object.fromEntries(insights.map((i) => [i.kind, i]));
    expect(byKind.channel.value).toBe("WhatsApp");
    expect(byKind.creative.adId).toBe("ad1");
    expect(byKind.creative.tone).toBe("success");
    expect(byKind.source.value).toBe("WhatsApp");
  });

  it("flags a channel with many leads and no sales as growth point", () => {
    const insights = buildAnalyticsInsights({
      channels: [channel({ meta: CHANNELS.instagram, leads: 12, sales: 0 })],
      sources: [],
      creatives: [],
    });
    const growth = insights.find((i) => i.kind === "growth");
    expect(growth?.value).toBe("Instagram");
    expect(growth?.tone).toBe("warning");
  });

  it("returns empty list when nothing is active", () => {
    expect(buildAnalyticsInsights({ channels: [], sources: [], creatives: [] })).toEqual([]);
  });
});
