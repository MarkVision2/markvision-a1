import { describe, it, expect } from "vitest";
import { metricsRnpDaily, sumRnpDaily } from "@/lib/metricsRnpDaily";
import type { LeadLite } from "@/hooks/useLeadsLite";
import type { StageChangeEvent } from "@/hooks/useStageChangeEvents";

function lead(partial: Partial<LeadLite> & Pick<LeadLite, "id" | "createdAt">): LeadLite {
  return {
    id: partial.id,
    projectId: partial.projectId ?? "p1",
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

function stageEvent(partial: Partial<StageChangeEvent> & Pick<StageChangeEvent, "leadId" | "at" | "toStageKey">): StageChangeEvent {
  return {
    cabinetId: partial.cabinetId ?? "cab-1",
    isDiagnostic: partial.isDiagnostic ?? true,
    ...partial,
    // после спреда: в Partial<> поле опционально, а в StageChangeEvent — обязательное
    toStageRole: partial.toStageRole ?? null,
  };
}

describe("metricsRnpDaily", () => {
  const range = {
    from: new Date(2026, 5, 1),
    to: new Date(2026, 5, 30),
  };

  it("считает вступления по stage_changed → joined_group", () => {
    const m = metricsRnpDaily(
      [lead({ id: "j1", createdAt: "2026-06-10T10:00:00+05:00" })],
      [
        stageEvent({
          leadId: "j1",
          at: "2026-06-11T12:00:00+05:00",
          toStageKey: "joined_group",
          isDiagnostic: false,
        }),
        stageEvent({
          leadId: "j1",
          at: "2026-06-11T13:00:00+05:00",
          toStageKey: "joined_group",
          isDiagnostic: false,
        }),
      ],
      range,
      "all",
    );
    expect(m.get("2026-06-11")?.joins).toBe(1);
    expect(sumRnpDaily(m).joins).toBe(1);
  });

  it("считает оплату диагностики только по paid_at + diagnostic_amount", () => {
    const m = metricsRnpDaily(
      [
        lead({
          id: "2",
          createdAt: "2026-05-20T10:00:00Z",
          diagnosticAmount: 5000,
          paidAt: "2026-05-24T12:00:00Z",
          stageKey: "visit",
        }),
      ],
      [],
      { from: new Date(2026, 4, 1), to: new Date(2026, 4, 31) },
      "all",
    );
    expect(m.get("2026-05-24")?.diagnosticsPaid).toBe(1);
    expect(m.get("2026-05-24")?.diagnosticRevenuePaid).toBe(5000);
  });

  it("не считает оплату диагностики без paid_at", () => {
    const m = metricsRnpDaily(
      [lead({ id: "3", createdAt: "2026-06-01T10:00:00Z", diagnosticAmount: 5000, stageKey: "visit" })],
      [],
      range,
      "all",
    );
    expect(m.get("2026-06-01")?.diagnosticsPaid ?? 0).toBe(0);
  });

  it("считает продажи и кассу по paid_at", () => {
    const m = metricsRnpDaily(
      [
        lead({
          id: "4",
          createdAt: "2026-06-01T10:00:00Z",
          paid: true,
          paidAt: "2026-06-10T08:00:00Z",
          amount: 120000,
          paymentMethod: "cash",
        }),
      ],
      [],
      range,
      "all",
    );
    expect(m.get("2026-06-10")?.sales).toBe(1);
    expect(m.get("2026-06-10")?.salesRevenue).toBe(120000);
    expect(m.get("2026-06-10")?.cashRevenue).toBe(120000);
  });

  it("считает записано/проведено через stage_changed", () => {
    const m = metricsRnpDaily(
      [lead({ id: "5", createdAt: "2026-06-01T10:00:00Z" })],
      [
        stageEvent({ leadId: "5", at: "2026-06-05T10:00:00Z", toStageKey: "scheduled" }),
        stageEvent({ leadId: "5", at: "2026-06-07T10:00:00Z", toStageKey: "visit" }),
      ],
      range,
      "all",
    );
    expect(m.get("2026-06-05")?.scheduled).toBe(1);
    expect(m.get("2026-06-07")?.conducted).toBe(1);
  });

  it("игнорирует переходы не в диагностическую воронку", () => {
    const m = metricsRnpDaily(
      [lead({ id: "6", createdAt: "2026-06-01T10:00:00Z" })],
      [
        stageEvent({
          leadId: "6",
          at: "2026-06-05T10:00:00Z",
          toStageKey: "scheduled",
          isDiagnostic: false,
        }),
      ],
      range,
      "all",
    );
    expect(m.get("2026-06-05")?.scheduled ?? 0).toBe(0);
  });

  it("sumRnpDaily суммирует по дням", () => {
    const map = metricsRnpDaily(
      [
        lead({ id: "7", createdAt: "2026-06-01T10:00:00Z" }),
        lead({ id: "8", createdAt: "2026-06-02T10:00:00Z" }),
      ],
      [],
      range,
      "all",
    );
    expect(sumRnpDaily(map).crmReceived).toBe(2);
  });
});
