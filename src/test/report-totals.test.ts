import { describe, it, expect } from "vitest";
import { computeTotals, aggregateCrm } from "@/hooks/useReportData";
import type { LeadLite } from "@/hooks/useLeadsLite";

const mkLead = (over: Partial<LeadLite> = {}): LeadLite => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  source: over.source ?? "whatsapp",
  channel: over.channel ?? null,
  referrer: over.referrer ?? null,
  utm: over.utm ?? null,
  cabinetId: over.cabinetId ?? null,
  stageKey: over.stageKey ?? "new",
  amount: over.amount ?? 0,
  diagnosticAmount: over.diagnosticAmount ?? 0,
  createdAt: over.createdAt ?? "2026-05-10T12:00:00Z",
  paidAt: over.paidAt ?? null,
  lastActivityAt: over.lastActivityAt ?? "2026-05-10T12:00:00Z",
  firstResponseAt: over.firstResponseAt ?? null,
  assigneeId: over.assigneeId ?? null,
  paid: over.paid ?? false,
  aiScore: over.aiScore ?? 0,
  scoreLabel: over.scoreLabel ?? null,
  rejectReason: over.rejectReason ?? null,
  rejectedAt: over.rejectedAt ?? null,
  stageId: over.stageId ?? null,
});

const range = { from: new Date("2026-05-01"), to: new Date("2026-05-31") };

const emptyMeta = {
  spend: 0, impressions: 0, clicks: 0, leads: 0,
  cabinetSales: 0, cabinetRevenue: 0, cabinetDiagnostics: 0, cabinetDiagnosticRevenue: 0,
};

describe("computeTotals — единая формула продаж и CAC", () => {
  it("сценарий пользователя: 2 продажи в CDI + 1 orphan = 3 в Итого (а не 2)", () => {
    const orphanLead = mkLead({ paid: true, amount: 400_000, cabinetId: null });
    const crm = aggregateCrm([orphanLead], range, "all");
    const meta = { ...emptyMeta, spend: 300_000, cabinetSales: 2, cabinetRevenue: 800_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(3);
    expect(totals.revenue).toBe(1_200_000);
  });

  it("CAC считается от общих продаж (CDI + orphan), а не только CDI", () => {
    const orphanLead = mkLead({ paid: true, amount: 100_000 });
    const crm = aggregateCrm([orphanLead], range, "all");
    const meta = { ...emptyMeta, spend: 300_000, cabinetSales: 2 };
    const totals = computeTotals(meta, crm);

    expect(totals.cac).toBe(100_000); // 300k / 3, а не 150k (300k / 2)
  });

  it("если orphan нет — итоги совпадают с CDI", () => {
    const crm = aggregateCrm([], range, "all");
    const meta = { ...emptyMeta, spend: 100_000, cabinetSales: 5, cabinetRevenue: 500_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(5);
    expect(totals.revenue).toBe(500_000);
    expect(totals.cac).toBe(20_000);
  });

  it("orphan revenue добавляется к diagnostic revenue в общую выручку", () => {
    const orphan = mkLead({ paid: true, amount: 50_000 });
    const crm = aggregateCrm([orphan], range, "all");
    const meta = { ...emptyMeta, cabinetRevenue: 200_000, cabinetDiagnosticRevenue: 30_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.revenue).toBe(280_000); // 200k + 30k + 50k
  });

  it("AOV = revenue / sales учитывает orphan", () => {
    const orphan = mkLead({ paid: true, amount: 100_000 });
    const crm = aggregateCrm([orphan], range, "all");
    const meta = { ...emptyMeta, cabinetSales: 1, cabinetRevenue: 200_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(2);
    expect(totals.revenue).toBe(300_000);
    expect(totals.aov).toBe(150_000);
  });

  it("ROMI считается на полную выручку с orphan", () => {
    const orphan = mkLead({ paid: true, amount: 400_000 });
    const crm = aggregateCrm([orphan], range, "all");
    const meta = { ...emptyMeta, spend: 500_000, cabinetRevenue: 600_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.romi).toBe(100); // (1_000_000 - 500_000) / 500_000 * 100
  });

  it("когда выбран конкретный кабинет — orphan не учитываются", () => {
    const orphan = mkLead({ paid: true, amount: 400_000 });
    const crm = aggregateCrm([orphan], range, "cab-123");
    const meta = { ...emptyMeta, spend: 300_000, cabinetSales: 2 };
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(2); // orphan не относится к этому кабинету
  });

  it("visits включают orphan-диагностики", () => {
    const orphanDiag = mkLead({ stageKey: "visit", amount: 0 });
    const crm = aggregateCrm([orphanDiag], range, "all");
    const meta = { ...emptyMeta, cabinetDiagnostics: 3 };
    const totals = computeTotals(meta, crm);

    expect(totals.visits).toBe(4);
  });

  it("totalLeads включают orphan-лиды (даже без оплаты)", () => {
    const orphan1 = mkLead({ paid: false });
    const orphan2 = mkLead({ paid: true, amount: 100_000 });
    const crm = aggregateCrm([orphan1, orphan2], range, "all");
    const meta = { ...emptyMeta, leads: 10, spend: 200_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.totalLeads).toBe(12);
    expect(totals.cpl).toBeCloseTo(200_000 / 12, 1);
  });
});

describe("aggregateCrm — orphan детектирование", () => {
  it("лид без cabinet_id попадает в orphanLeads", () => {
    const lead = mkLead({ cabinetId: null, paid: true, amount: 100_000 });
    const crm = aggregateCrm([lead], range, "all");
    expect(crm.orphanLeads.length).toBe(1);
    expect(crm.orphanSales.length).toBe(1);
    expect(crm.orphanRevenue).toBe(100_000);
  });

  it("лид с cabinet_id НЕ попадает в orphanLeads (учитывается через CDI)", () => {
    const lead = mkLead({ cabinetId: "cab-1", paid: true, amount: 100_000 });
    const crm = aggregateCrm([lead], range, "all");
    expect(crm.orphanLeads.length).toBe(0);
  });

  it("лид создан раньше периода, но оплачен в периоде — учитывается (как CDI)", () => {
    // CDI считает продажи по paid_at — старая логика по createdAt теряла такие продажи.
    const lead = mkLead({
      createdAt: "2026-04-15T12:00:00Z",
      paidAt: "2026-05-10T12:00:00Z",
      paid: true,
      amount: 100_000,
    });
    const crm = aggregateCrm([lead], range, "all");
    expect(crm.orphanSales.length).toBe(1);
    expect(crm.orphanRevenue).toBe(100_000);
  });

  it("лид создан и оплачен ДО периода — не учитывается", () => {
    const lead = mkLead({
      createdAt: "2026-04-15T12:00:00Z",
      paidAt: "2026-04-20T12:00:00Z",
      lastActivityAt: "2026-04-20T12:00:00Z",
      paid: true,
      amount: 100_000,
    });
    const crm = aggregateCrm([lead], range, "all");
    expect(crm.orphanSales.length).toBe(0);
  });

  it("isLeadPaid срабатывает по paid=true даже без paid stageKey", () => {
    const lead = mkLead({ paid: true, stageKey: "in_progress", amount: 50_000 });
    const crm = aggregateCrm([lead], range, "all");
    expect(crm.orphanSales.length).toBe(1);
    expect(crm.orphanRevenue).toBe(50_000);
  });

  it("при выборе конкретного кабинета orphan не возвращаются", () => {
    const lead = mkLead({ cabinetId: null, paid: true, amount: 100_000 });
    const crm = aggregateCrm([lead], range, "cab-123");
    expect(crm.orphanLeads.length).toBe(0);
    expect(crm.orphanSales.length).toBe(0);
  });
});
