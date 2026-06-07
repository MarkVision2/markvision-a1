import { describe, it, expect } from "vitest";
import { computeTotals, aggregateCrm } from "@/hooks/useReportData";
import type { LeadLite } from "@/hooks/useLeadsLite";
import {
  resolvedMetricsFromCrmAggregate,
  sumResolvedMetricsPerCabinets,
  findCdiRowForCabinet,
} from "@/lib/metricsSourceOfTruth";

const mkLead = (over: Partial<LeadLite> = {}): LeadLite => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  source: over.source ?? "whatsapp",
  channel: over.channel ?? null,
  referrer: over.referrer ?? null,
  utm: over.utm ?? null,
  metaAdId: over.metaAdId ?? null,
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

describe("computeTotals — Таблица показателей (CRM + manual override)", () => {
  it("ручная правка диагностик в CDI перезаписывает CRM в итогах", () => {
    const d1 = mkLead({ cabinetId: "cab-1", stageKey: "scheduled", lastActivityAt: "2026-05-10T10:00:00Z" });
    const d2 = mkLead({ cabinetId: "cab-1", stageKey: "scheduled", lastActivityAt: "2026-05-10T14:00:00Z" });
    const crm = aggregateCrm([d1, d2], range, "all");
    const resolved = sumResolvedMetricsPerCabinets(
      range,
      [d1, d2],
      [{
        cabinet_id: "cab-1",
        date: "2026-05-10",
        manual_diagnostics: 1,
        manual_diagnostic_revenue: null,
        manual_sales: null,
        manual_revenue: null,
      }],
      ["cab-1"],
      false,
    );
    const totals = computeTotals({ ...emptyMeta, spend: 50_000 }, crm, resolved);

    expect(totals.visits).toBe(1);
  });

  it("CDI без cabinet_id: manual 10k находится по external_id", () => {
    const row = findCdiRowForCabinet(
      [{
        date: "2026-06-10",
        cabinet_id: null,
        external_id: "act_123",
        manual_diagnostic_revenue: 10_000,
        manual_diagnostics: null,
        manual_sales: null,
        manual_revenue: null,
      }],
      "2026-06-10",
      "cab-1",
      "act_123",
      ["cab-1"],
    );
    expect(row?.manual_diagnostic_revenue).toBe(10_000);
  });

  it("orphan учитывается, если manual в CDI есть, но не сматчился к кабинету", () => {
    const orphanDiag = mkLead({
      cabinetId: null,
      stageKey: "visit",
      diagnosticAmount: 10_000,
      lastActivityAt: "2026-06-10T12:00:00Z",
    });
    const june = { from: new Date("2026-06-01"), to: new Date("2026-06-30") };
    const resolved = sumResolvedMetricsPerCabinets(
      june,
      [orphanDiag],
      [{
        cabinet_id: "other-cab",
        date: "2026-06-10",
        manual_diagnostics: 1,
        manual_diagnostic_revenue: 10_000,
        manual_sales: null,
        manual_revenue: null,
      }],
      ["cab-1"],
      true,
      new Map([["cab-1", "act_999"]]),
    );

    expect(resolved.revenue).toBe(10_000);
    expect(resolved.diagnostics).toBe(1);
  });

  it("manual override не дублируется с orphan-CRM в тот же день", () => {
    const orphanDiag = mkLead({
      cabinetId: null,
      stageKey: "visit",
      diagnosticAmount: 10_000,
      lastActivityAt: "2026-06-10T12:00:00Z",
    });
    const june = { from: new Date("2026-06-01"), to: new Date("2026-06-30") };
    const crm = aggregateCrm([orphanDiag], june, "all");
    const resolved = sumResolvedMetricsPerCabinets(
      june,
      [orphanDiag],
      [{
        cabinet_id: "cab-1",
        date: "2026-06-10",
        manual_diagnostics: 1,
        manual_diagnostic_revenue: 10_000,
        manual_sales: null,
        manual_revenue: null,
      }],
      ["cab-1"],
      true,
    );
    const totals = computeTotals({ ...emptyMeta }, crm, resolved);

    expect(totals.visits).toBe(1);
    expect(totals.revenue).toBe(10_000);
  });

  it("ручная выручка диагностик 10k перезаписывает CRM 5k", () => {
    const d1 = mkLead({
      cabinetId: "cab-1",
      stageKey: "scheduled",
      diagnosticAmount: 5_000,
      lastActivityAt: "2026-06-10T10:00:00Z",
    });
    const june = { from: new Date("2026-06-01"), to: new Date("2026-06-30") };
    const crm = aggregateCrm([d1], june, "all");
    const resolved = sumResolvedMetricsPerCabinets(
      june,
      [d1],
      [{
        cabinet_id: null,
        external_id: "act_999",
        date: "2026-06-10",
        manual_diagnostics: null,
        manual_diagnostic_revenue: 10_000,
        manual_sales: null,
        manual_revenue: null,
      }],
      ["cab-1"],
      false,
      new Map([["cab-1", "act_999"]]),
    );
    const totals = computeTotals({ ...emptyMeta }, crm, resolved);

    expect(totals.visits).toBe(1);
    expect(totals.revenue).toBe(10_000);
  });
  it("3 продажи в CRM: 400k+800k+500k = 1.7M, CDI инфлирован — игнорим", () => {
    // Сценарий пользователя: CDI протух (3.4М ₸), но в CRM реально 1.7М.
    // Раньше брали max → инфлированный CDI побеждал. Теперь CRM — правда.
    const s1 = mkLead({ cabinetId: "cab-1", paid: true, amount: 400_000, paidAt: "2026-05-10T10:00:00Z" });
    const s2 = mkLead({ cabinetId: "cab-1", paid: true, amount: 800_000, paidAt: "2026-05-12T10:00:00Z" });
    const s3 = mkLead({ cabinetId: null, paid: true, amount: 500_000, paidAt: "2026-05-15T10:00:00Z" });
    const crm = aggregateCrm([s1, s2, s3], range, "all");
    const meta = { ...emptyMeta, spend: 300_000, cabinetSales: 99, cabinetRevenue: 9_999_999 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(3);
    expect(totals.revenue).toBe(1_700_000);
    expect(totals.cac).toBe(100_000); // 300k / 3
  });

  it("если CRM пуст — продажи 0 (даже если CDI хочет что-то показать)", () => {
    const crm = aggregateCrm([], range, "all");
    const meta = { ...emptyMeta, spend: 100_000, cabinetSales: 5, cabinetRevenue: 500_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(0);
    expect(totals.revenue).toBe(0);
    expect(totals.cac).toBe(0);
  });

  it("выручка = sales amount + diagnostic_amount (всё из CRM)", () => {
    const paidWithDiag = mkLead({
      cabinetId: "cab-1", paid: true, amount: 500_000, diagnosticAmount: 5_000,
      paidAt: "2026-05-10T10:00:00Z",
    });
    const crm = aggregateCrm([paidWithDiag], range, "all");
    const meta = { ...emptyMeta, cabinetRevenue: 9_999_999, cabinetDiagnosticRevenue: 9_999_999 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.revenue).toBe(505_000); // 500k + 5k diagnostic
  });

  it("AOV = выручка / продажи", () => {
    const s1 = mkLead({ cabinetId: "cab-1", paid: true, amount: 200_000 });
    const s2 = mkLead({ cabinetId: null, paid: true, amount: 100_000 });
    const crm = aggregateCrm([s1, s2], range, "all");
    const totals = computeTotals({ ...emptyMeta }, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(2);
    expect(totals.revenue).toBe(300_000);
    expect(totals.aov).toBe(150_000);
  });

  it("ROMI на CRM-выручке: (1М - 500k) / 500k = 100%", () => {
    const s1 = mkLead({ cabinetId: "cab-1", paid: true, amount: 600_000 });
    const s2 = mkLead({ cabinetId: null, paid: true, amount: 400_000 });
    const crm = aggregateCrm([s1, s2], range, "all");
    const meta = { ...emptyMeta, spend: 500_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.romi).toBe(100);
  });

  it("при выборе конкретного кабинета — только лиды этого кабинета", () => {
    const cab1 = mkLead({ cabinetId: "cab-1", paid: true, amount: 300_000 });
    const cab2 = mkLead({ cabinetId: "cab-2", paid: true, amount: 500_000 });
    const orphan = mkLead({ cabinetId: null, paid: true, amount: 400_000 });
    const crm = aggregateCrm([cab1, cab2, orphan], range, "cab-1");
    const totals = computeTotals({ ...emptyMeta, spend: 100_000 }, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(300_000);
  });

  it("visits = все лиды в диаг-стадии (CRM), не из CDI", () => {
    const d1 = mkLead({ cabinetId: "cab-1", stageKey: "scheduled" });
    const d2 = mkLead({ cabinetId: "cab-1", stageKey: "visit" });
    const d3 = mkLead({ cabinetId: null, stageKey: "scheduled" });
    const d4 = mkLead({ cabinetId: "cab-2", paid: true, amount: 100_000 });
    const crm = aggregateCrm([d1, d2, d3, d4], range, "all");
    const meta = { ...emptyMeta, cabinetDiagnostics: 999 }; // CDI протух — игнор
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.visits).toBe(3); // scheduled/visit; оплаченный paid — продажа, не диагностика
  });

  it("totalLeads = Meta-лиды (CDI) + orphan CRM (без cabinet_id)", () => {
    const orphan1 = mkLead({ paid: false });
    const orphan2 = mkLead({ paid: true, amount: 100_000 });
    const crm = aggregateCrm([orphan1, orphan2], range, "all");
    const meta = { ...emptyMeta, leads: 10, spend: 200_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

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
