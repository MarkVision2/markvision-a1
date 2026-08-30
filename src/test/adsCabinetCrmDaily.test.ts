import { describe, expect, it } from "vitest";
import {
  buildAdsCabinetCrmDaily,
  isDiagnosticStageEvent,
  sumAdsCabinetCrmDaily,
} from "@/lib/adsCabinetCrmDaily";
import type { LeadLite } from "@/hooks/useLeadsLite";
import type { StageChangeEvent } from "@/hooks/useStageChangeEvents";

function lead(partial: Partial<LeadLite> & Pick<LeadLite, "id" | "cabinetId" | "createdAt">): LeadLite {
  return {
    projectId: "p1",
    source: "meta",
    channel: "instagram",
    referrer: null,
    utm: null,
    metaAdId: null,
    clickId: null,
    stageKey: "new",
    stageRole: "new",
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

describe("adsCabinetCrmDaily", () => {
  it("detects diagnostic / visit / consultation stages", () => {
    expect(isDiagnosticStageEvent({ toStageKey: "diagnostic", toStageRole: null, isDiagnostic: false })).toBe(true);
    expect(isDiagnosticStageEvent({ toStageKey: "visit", toStageRole: null, isDiagnostic: false })).toBe(true);
    expect(isDiagnosticStageEvent({ toStageKey: "new", toStageRole: null, isDiagnostic: false })).toBe(false);
    expect(isDiagnosticStageEvent({ toStageKey: "paid", toStageRole: null, isDiagnostic: false })).toBe(false);
  });

  it("counts CRM leads, diagnostics by stage event day, and paid sales by paid_at", () => {
    const leads = [
      lead({ id: "a", cabinetId: "cab1", createdAt: "2026-07-10T05:00:00+05:00" }),
      lead({
        id: "b",
        cabinetId: "cab1",
        createdAt: "2026-07-10T20:00:00+05:00",
        paid: true,
        paidAt: "2026-07-12T10:00:00+05:00",
        amount: 150000,
      }),
      lead({ id: "c", cabinetId: "cab2", createdAt: "2026-07-10T12:00:00+05:00" }),
      lead({ id: "d", cabinetId: "cab1", createdAt: "2026-07-11T12:00:00+05:00" }),
    ];
    const events: StageChangeEvent[] = [
      { leadId: "a", cabinetId: "cab1", at: "2026-07-10T18:00:00+05:00", toStageKey: "diagnostic", toStageRole: null, isDiagnostic: false },
      { leadId: "a", cabinetId: "cab1", at: "2026-07-10T19:00:00+05:00", toStageKey: "visit", toStageRole: null, isDiagnostic: false },
      { leadId: "b", cabinetId: "cab1", at: "2026-07-11T09:00:00+05:00", toStageKey: "scheduled", toStageRole: "call_scheduled", isDiagnostic: false },
      { leadId: "c", cabinetId: "cab2", at: "2026-07-10T15:00:00+05:00", toStageKey: "diagnostic", toStageRole: null, isDiagnostic: false },
    ];

    const byDay = buildAdsCabinetCrmDaily(leads, events, "cab1", "2026-07-01", "2026-07-31");
    expect(byDay.get("2026-07-10")).toEqual({ crmLeads: 2, diagnostics: 1, sales: 0, salesRevenue: 0 });
    expect(byDay.get("2026-07-11")).toEqual({ crmLeads: 1, diagnostics: 1, sales: 0, salesRevenue: 0 });
    expect(byDay.get("2026-07-12")).toEqual({ crmLeads: 0, diagnostics: 0, sales: 1, salesRevenue: 150000 });
    expect(sumAdsCabinetCrmDaily(byDay)).toEqual({ crmLeads: 3, diagnostics: 2, sales: 1, salesRevenue: 150000 });
  });

  it("sole Meta cabinet counts unattributed zapoinovai/meta utm leads", () => {
    const leads = [
      lead({
        id: "z1",
        cabinetId: null,
        createdAt: "2026-08-01T05:00:00+05:00",
        source: "zapoinovai",
        utm: { source: "meta" },
      }),
      lead({
        id: "z2",
        cabinetId: null,
        createdAt: "2026-08-01T06:00:00+05:00",
        source: "broadcast_zoom",
        utm: { source: "meta" },
      }),
      lead({
        id: "z3",
        cabinetId: "cab1",
        createdAt: "2026-08-01T07:00:00+05:00",
      }),
    ];
    const byDay = buildAdsCabinetCrmDaily(leads, [], "cab1", "2026-08-01", "2026-08-31", {
      soleMetaCabinet: true,
    });
    expect(sumAdsCabinetCrmDaily(byDay)).toEqual({ crmLeads: 2, diagnostics: 0, sales: 0, salesRevenue: 0 });
  });

  // Реальный случай (кабинет GULNARA, август 2026): у заявок Click-to-WhatsApp
  // нет ни cabinet_id, ни utm, ни meta_ad_id — source='whatsapp' и ctwa_clid
  // в click_id. Раньше такие лиды не попадали в «Лиды CRM» карточки кабинета.
  it("считает Click-to-WhatsApp заявки лидами единственного Meta-кабинета", () => {
    const leads: LeadLite[] = [
      lead({
        id: "ctwa-1", cabinetId: null, createdAt: "2026-08-05T09:00:00.000Z",
        source: "whatsapp", channel: "whatsapp", utm: null, clickId: "AfjEvFh2T2-k6z_Axkqt",
      }),
      lead({
        id: "ctwa-2", cabinetId: null, createdAt: "2026-08-06T09:00:00.000Z",
        source: "whatsapp", channel: "whatsapp", utm: null, clickId: "AfjsJq10bQ",
      }),
      // Органика: тот же канал, но клика по рекламе не было — не должна попасть
      lead({
        id: "organic", cabinetId: null, createdAt: "2026-08-07T09:00:00.000Z",
        source: "whatsapp", channel: "whatsapp", utm: null, clickId: null,
      }),
    ];

    const sole = sumAdsCabinetCrmDaily(
      buildAdsCabinetCrmDaily(leads, [], "cab-1", "2026-08-01", "2026-08-31", { soleMetaCabinet: true }),
    );
    expect(sole.crmLeads).toBe(2);

    // Кабинетов несколько — гадать нельзя, запасная атрибуция не работает
    const multi = sumAdsCabinetCrmDaily(
      buildAdsCabinetCrmDaily(leads, [], "cab-1", "2026-08-01", "2026-08-31", { soleMetaCabinet: false }),
    );
    expect(multi.crmLeads).toBe(0);
  });

  it("рассылку в WhatsApp не считает рекламным лидом даже с click_id", () => {
    const leads: LeadLite[] = [
      lead({
        id: "bc", cabinetId: null, createdAt: "2026-08-05T09:00:00.000Z",
        source: "broadcast:wa", channel: "whatsapp", utm: null, clickId: "Afsomething",
      }),
    ];
    const res = sumAdsCabinetCrmDaily(
      buildAdsCabinetCrmDaily(leads, [], "cab-1", "2026-08-01", "2026-08-31", { soleMetaCabinet: true }),
    );
    expect(res.crmLeads).toBe(0);
  });
});
