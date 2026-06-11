import { describe, it, expect } from "vitest";
import { metricsRnpDaily } from "@/lib/metricsRnpDaily";
import type { LeadLite } from "@/hooks/useLeadsLite";
import { isLeadConductedVisit } from "@/lib/leadStageFlags";

function lead(partial: Partial<LeadLite> & Pick<LeadLite, "id" | "createdAt">): LeadLite {
  return {
    id: partial.id,
    source: "whatsapp",
    channel: "whatsapp",
    referrer: null,
    utm: null,
    metaAdId: null,
    cabinetId: partial.cabinetId ?? "cab-1",
    stageKey: partial.stageKey ?? "new",
    amount: partial.amount ?? 0,
    diagnosticAmount: partial.diagnosticAmount ?? 0,
    createdAt: partial.createdAt,
    paidAt: partial.paidAt ?? null,
    lastActivityAt: partial.lastActivityAt ?? partial.createdAt,
    firstResponseAt: null,
    assigneeId: null,
    paid: partial.paid ?? false,
    aiScore: 50,
    scoreLabel: null,
    rejectReason: null,
    rejectedAt: null,
    stageId: null,
    nextVisitAt: partial.nextVisitAt ?? null,
    paymentMethod: partial.paymentMethod ?? null,
  };
}

describe("isLeadConductedVisit", () => {
  it("scheduled не считается проведённым", () => {
    expect(isLeadConductedVisit({ stageKey: "scheduled", paid: false, diagnosticAmount: 0 })).toBe(false);
  });

  it("visit считается проведённым", () => {
    expect(isLeadConductedVisit({ stageKey: "visit", paid: false, diagnosticAmount: 0 })).toBe(true);
  });

  it("оплата диагностики — проведено", () => {
    expect(isLeadConductedVisit({ stageKey: "scheduled", paid: false, diagnosticAmount: 5000 })).toBe(true);
  });
});

describe("metricsRnpDaily", () => {
  const range = {
    from: new Date(2026, 5, 1),
    to: new Date(2026, 5, 30),
  };

  it("считает получено CRM по created_at", () => {
    const m = metricsRnpDaily(
      [lead({ id: "1", createdAt: "2026-06-11T10:00:00Z" })],
      range,
      "all",
    );
    expect(m.get("2026-06-11")?.crmReceived).toBe(1);
  });

  it("считает оплату диагностики", () => {
    const m = metricsRnpDaily(
      [
        lead({
          id: "2",
          createdAt: "2026-05-20T10:00:00Z",
          diagnosticAmount: 5000,
          lastActivityAt: "2026-05-24T12:00:00Z",
          stageKey: "visit",
        }),
      ],
      { from: new Date(2026, 4, 1), to: new Date(2026, 4, 31) },
      "all",
    );
    expect(m.get("2026-05-24")?.diagnosticsPaid).toBe(1);
    expect(m.get("2026-05-24")?.diagnosticRevenuePaid).toBe(5000);
  });
});
