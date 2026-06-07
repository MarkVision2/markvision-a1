import { describe, it, expect } from "vitest";
import { buildDashboardChannels } from "@/lib/dashboardChannels";
import type { LeadLite } from "@/hooks/useLeadsLite";

const mk = (over: Partial<LeadLite> = {}): LeadLite => ({
  id: over.id ?? "1",
  source: over.source ?? "whatsapp",
  channel: over.channel ?? null,
  referrer: over.referrer ?? null,
  utm: over.utm ?? null,
  cabinetId: over.cabinetId ?? "cab-1",
  stageKey: over.stageKey ?? "new",
  amount: over.amount ?? 0,
  diagnosticAmount: over.diagnosticAmount ?? 0,
  createdAt: over.createdAt ?? "2026-06-10T12:00:00Z",
  paidAt: over.paidAt ?? null,
  lastActivityAt: over.lastActivityAt ?? "2026-06-10T12:00:00Z",
  firstResponseAt: over.firstResponseAt ?? null,
  assigneeId: over.assigneeId ?? null,
  paid: over.paid ?? false,
  aiScore: over.aiScore ?? 0,
  scoreLabel: over.scoreLabel ?? null,
  rejectReason: over.rejectReason ?? null,
  rejectedAt: over.rejectedAt ?? null,
  stageId: over.stageId ?? null,
});

const range = {
  fromTs: new Date("2026-06-01").getTime(),
  toTs: new Date("2026-07-01").getTime(),
};

describe("buildDashboardChannels", () => {
  it("добавляет Meta-лиды из CDI, которых нет в CRM", () => {
    const channels = buildDashboardChannels({
      leads: [mk({ source: "whatsapp" }), mk({ source: "whatsapp" })],
      totals: {
        spend: 60_000, impressions: 9000, clicks: 180, adsLeads: 29, crmLeads: 2,
        totalLeads: 29, visits: 1, sales: 0, revenue: 10_000,
        cpl: 2000, cpv: 0, cac: 0, ctr: 2, romi: -83, aov: 0,
      },
      providerAgg: [{ provider: "meta", spend: 60_000, leads: 29 }],
      fromTs: range.fromTs,
      toTs: range.toTs,
    });

    const totalChannelLeads = channels.reduce((s, c) => s + c.leads, 0);
    expect(totalChannelLeads).toBe(29);
    const site = channels.find((c) => c.provider === "site");
    expect(site?.leads).toBe(27);
  });

  it("не показывает пустые каналы", () => {
    const channels = buildDashboardChannels({
      leads: [mk()],
      totals: undefined,
      providerAgg: [],
      fromTs: range.fromTs,
      toTs: range.toTs,
    });
    expect(channels.every((c) => c.leads > 0 || c.spend > 0)).toBe(true);
  });
});
