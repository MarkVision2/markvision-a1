import { describe, it, expect } from "vitest";
import { crmDailyMetrics } from "@/lib/crmDailyMetrics";
import type { LeadLite } from "@/hooks/useLeadsLite";

const mkLead = (over: Partial<LeadLite> = {}): LeadLite => ({
  id: over.id ?? "1",
  projectId: over.projectId ?? "p1",
  source: over.source ?? "whatsapp",
  channel: over.channel ?? null,
  referrer: over.referrer ?? null,
  utm: over.utm ?? null,
  metaAdId: over.metaAdId ?? null,
  clickId: over.clickId ?? null,
  cabinetId: over.cabinetId ?? null,
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
  nextVisitAt: over.nextVisitAt ?? null,
  paymentMethod: over.paymentMethod ?? null,
});

describe("crmDailyMetrics — Asia/Almaty day keys", () => {
  it("оплата после полуночи Almaty попадает в правильный день CDI", () => {
    // 2026-06-01T20:00:00Z = 2026-06-02 01:00 Asia/Almaty
    const lead = mkLead({
      paid: true,
      amount: 350_000,
      paidAt: "2026-06-01T20:00:00Z",
    });
    const june2 = { from: new Date(2026, 5, 2), to: new Date(2026, 5, 2) };
    const m = crmDailyMetrics([lead], june2, "all");

    expect(m.get("2026-06-02")?.sales).toBe(1);
    expect(m.get("2026-06-02")?.salesRevenue).toBe(350_000);
    expect(m.get("2026-06-01")).toBeUndefined();
  });
});
