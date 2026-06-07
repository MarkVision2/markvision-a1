import { describe, it, expect } from "vitest";
import { computeTotals, aggregateCrm } from "@/hooks/useReportData";
import type { LeadLite } from "@/hooks/useLeadsLite";
import { resolvedMetricsFromCrmAggregate } from "@/lib/metricsSourceOfTruth";

const mk = (over: Partial<LeadLite> = {}): LeadLite => ({
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

describe("Сквозная воронка: реклама → CRM (источник правды) → таблица показателей", () => {
  it("воронка из 5 лидов с 3 диагностиками и 1 продажей: считаем из CRM", () => {
    // 5 лидов из Meta, 3 в scheduled, 1 paid с amount 150k и diag 5k.
    const l1 = mk({ cabinetId: "cab-1", stageKey: "scheduled" });
    const l2 = mk({ cabinetId: "cab-1", stageKey: "scheduled" });
    const l3 = mk({ cabinetId: "cab-1", stageKey: "scheduled" });
    const l4 = mk({ cabinetId: "cab-1", paid: true, amount: 150_000, diagnosticAmount: 5_000,
                    paidAt: "2026-05-10T10:00:00Z" });
    const l5 = mk({ cabinetId: "cab-1", stageKey: "new" });
    const meta = { ...emptyMeta,
      spend: 200_000, impressions: 50_000, clicks: 1_500, leads: 5,
      cabinetDiagnostics: 999, cabinetSales: 999, cabinetRevenue: 999_999,
    };
    const crm = aggregateCrm([l1, l2, l3, l4, l5], range, "all");
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.adsLeads).toBe(5);
    expect(totals.totalLeads).toBe(5);
    expect(totals.visits).toBe(4); // 3 scheduled + 1 paid (paid тоже visit)
    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(155_000); // 150k + 5k diagnostic
    expect(totals.cpl).toBe(40_000);
    expect(totals.cac).toBe(200_000);
  });

  it("orphan WhatsApp + cab-paid: оба считаются", () => {
    const orphanWhatsApp = mk({
      source: "whatsapp", cabinetId: null, paid: true, amount: 100_000,
      createdAt: "2026-05-15T10:00:00Z",
    });
    const cabSale = mk({ cabinetId: "cab-1", paid: true, amount: 50_000 });
    const meta = { ...emptyMeta, spend: 50_000, leads: 2, cabinetSales: 1, cabinetRevenue: 50_000 };
    const crm = aggregateCrm([orphanWhatsApp, cabSale], range, "all");
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(2);
    expect(totals.revenue).toBe(150_000);
    expect(totals.cac).toBe(25_000);
    expect(totals.totalLeads).toBe(3); // 2 Meta + 1 orphan
  });

  it("CR воронки: лид → диагностика → продажа (из CRM)", () => {
    const leads_ = [
      ...Array(5).fill(0).map(() => mk({ cabinetId: "cab-1", stageKey: "new" })),
      ...Array(3).fill(0).map(() => mk({ cabinetId: "cab-1", stageKey: "scheduled" })),
      ...Array(2).fill(0).map(() => mk({ cabinetId: "cab-1", paid: true, amount: 100_000 })),
    ];
    const meta = { ...emptyMeta, leads: 10 };
    const crm = aggregateCrm(leads_, range, "all");
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.visits).toBe(3); // только scheduled; оплаченные — продажи, не диагностики
    expect(totals.sales).toBe(2);
  });

  it("стоимость лида / диагностики / клиента — на одинаковых продажах", () => {
    const d1 = mk({ cabinetId: "cab-1", stageKey: "scheduled" });
    const d2 = mk({ cabinetId: "cab-1", stageKey: "scheduled" });
    const cabPaid = mk({ cabinetId: "cab-1", paid: true, amount: 100_000 });
    const orphan = mk({ paid: true, amount: 100_000 });
    const meta = { ...emptyMeta, spend: 600_000, leads: 6 };
    const crm = aggregateCrm([d1, d2, cabPaid, orphan], range, "all");
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.totalLeads).toBe(7);
    expect(totals.visits).toBe(2); // 2 scheduled; paid — продажи
    expect(totals.sales).toBe(2);
    expect(totals.cpv).toBe(300_000); // 600k / 2
    expect(totals.cac).toBe(300_000); // 600k / 2
  });

  it("плательщик считается один раз", () => {
    const lead = mk({ paid: true, stageKey: "paid", amount: 50_000 });
    const crm = aggregateCrm([lead], range, "all");
    const totals = computeTotals({ ...emptyMeta }, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(50_000);
  });

  it("ROMI на CRM выручке", () => {
    const cab = mk({ cabinetId: "cab-1", paid: true, amount: 300_000 });
    const orphan = mk({ paid: true, amount: 500_000 });
    const crm = aggregateCrm([cab, orphan], range, "all");
    const meta = { ...emptyMeta, spend: 400_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.romi).toBe(100);
  });

  it("orphan без оплаты только в leads, но не в sales", () => {
    const lead = mk({ paid: false, stageKey: "new" });
    const crm = aggregateCrm([lead], range, "all");

    expect(crm.orphanLeads.length).toBe(1);
    expect(crm.orphanSales.length).toBe(0);
    expect(crm.orphanRevenue).toBe(0);
  });
});

describe("Фильтрация продаж по paid_at (а не createdAt) — sync с CDI", () => {
  it("лид создан в апреле, оплачен в мае: попадает в майские продажи", () => {
    const lead = mk({
      createdAt: "2026-04-15T12:00:00Z",
      paidAt: "2026-05-10T12:00:00Z",
      paid: true,
      amount: 300_000,
    });
    const crm = aggregateCrm([lead], range, "all");
    const meta = { ...emptyMeta, spend: 100_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(300_000);
    expect(totals.cac).toBe(100_000);
  });

  it("лид создан в мае, оплачен в июне: НЕ в майские продажи", () => {
    const lead = mk({
      createdAt: "2026-05-15T12:00:00Z",
      paidAt: "2026-06-10T12:00:00Z",
      lastActivityAt: "2026-06-10T12:00:00Z",
      paid: true,
      amount: 300_000,
    });
    const crm = aggregateCrm([lead], range, "all");
    const meta = { ...emptyMeta, spend: 100_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(0); // оплачен в июне → майских продаж нет
    expect(totals.crmLeads).toBe(1); // но как лид мая учитывается
  });

  it("несколько лидов: 1 создан раньше + оплачен в периоде, 1 свежий", () => {
    const oldPaidNow = mk({
      createdAt: "2026-04-01T10:00:00Z",
      paidAt: "2026-05-20T10:00:00Z",
      paid: true,
      amount: 200_000,
    });
    const freshPaid = mk({
      createdAt: "2026-05-10T10:00:00Z",
      paidAt: "2026-05-15T10:00:00Z",
      paid: true,
      amount: 100_000,
    });
    const crm = aggregateCrm([oldPaidNow, freshPaid], range, "all");

    expect(crm.orphanSales.length).toBe(2);
    expect(crm.orphanRevenue).toBe(300_000);
  });
});

describe("CDI отстаёт от CRM — CRM становится источником правды", () => {
  it("CRM имеет 3 продажи (2 cab + 1 orphan), но CDI триггер пропустил одну (только 1)", () => {
    // Реальный сценарий пользователя: 3 продажи в CRM, 2 в Funnel.
    // Триггер CDI не сработал у одной — например, cabinet_id присвоен после оплаты.
    const cabPaid1 = mk({ cabinetId: "cab-1", paid: true, amount: 100_000, paidAt: "2026-05-10T10:00:00Z" });
    const cabPaid2 = mk({ cabinetId: "cab-1", paid: true, amount: 200_000, paidAt: "2026-05-12T10:00:00Z" });
    const cabPaid3 = mk({ cabinetId: "cab-2", paid: true, amount: 150_000, paidAt: "2026-05-15T10:00:00Z" });
    const crm = aggregateCrm([cabPaid1, cabPaid2, cabPaid3], range, "all");
    // CDI показывает только 1 (триггер пропустил 2)
    const meta = { ...emptyMeta, spend: 300_000, cabinetSales: 1, cabinetRevenue: 100_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(3); // CRM = 3, max(1+0, 3) = 3
    expect(totals.revenue).toBe(450_000); // CRM revenue = 100+200+150
  });

  it("3 диагностики в CRM, но CDI показывает только 1 — берём CRM", () => {
    const scheduled1 = mk({ cabinetId: "cab-1", stageKey: "scheduled", lastActivityAt: "2026-05-10T10:00:00Z" });
    const scheduled2 = mk({ cabinetId: "cab-1", stageKey: "visit", lastActivityAt: "2026-05-12T10:00:00Z" });
    const scheduledOrphan = mk({ cabinetId: null, stageKey: "scheduled", lastActivityAt: "2026-05-15T10:00:00Z" });
    const crm = aggregateCrm([scheduled1, scheduled2, scheduledOrphan], range, "all");
    const meta = { ...emptyMeta, spend: 200_000, cabinetDiagnostics: 1 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.visits).toBe(3); // CRM = 3, max(1+1, 3) = 3
  });

  it("CDI инфлирован (старые триггеры дублировали) — игнорируем", () => {
    // Реальный кейс: CDI показывал 3.4М ₸ при реальных 1.3М в CRM.
    // Раньше брался max — инфлированный CDI побеждал. Теперь CRM = правда.
    const cabPaid = mk({ cabinetId: "cab-1", paid: true, amount: 100_000 });
    const crm = aggregateCrm([cabPaid], range, "all");
    const meta = { ...emptyMeta, spend: 200_000, cabinetSales: 5, cabinetRevenue: 500_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(1); // CRM = 1
    expect(totals.revenue).toBe(100_000); // CRM = 100k
  });

  it("стандартный случай: CDI и CRM согласованы (нет потерь)", () => {
    const cab1 = mk({ cabinetId: "cab-1", paid: true, amount: 100_000 });
    const cab2 = mk({ cabinetId: "cab-1", paid: true, amount: 200_000 });
    const orphan = mk({ cabinetId: null, paid: true, amount: 50_000 });
    const crm = aggregateCrm([cab1, cab2, orphan], range, "all");
    const meta = { ...emptyMeta, cabinetSales: 2, cabinetRevenue: 300_000 }; // CDI знает про 2 cab

    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));
    expect(totals.sales).toBe(3); // CDI(2) + orphan(1) = 3 = CRM total — без расхождений
    expect(totals.revenue).toBe(350_000); // 300k cab + 50k orphan
  });
});

describe("Изоляция данных при выборе конкретного кабинета", () => {
  it("orphan не показываются для конкретного кабинета", () => {
    const orphan = mk({ paid: true, amount: 200_000, cabinetId: null });
    const cabLead = mk({ paid: true, amount: 300_000, cabinetId: "cab-1" });

    const crmAll = aggregateCrm([orphan, cabLead], range, "all");
    expect(crmAll.orphanLeads.length).toBe(1);

    const crmCab = aggregateCrm([orphan, cabLead], range, "cab-1");
    expect(crmCab.orphanLeads.length).toBe(0);
  });

  it("при выборе кабинета итоги = только CRM-лиды выбранного кабинета", () => {
    const orphan = mk({ paid: true, amount: 200_000 });
    const cabLead = mk({ cabinetId: "cab-1", paid: true, amount: 50_000 });
    const crm = aggregateCrm([orphan, cabLead], range, "cab-1");
    const meta = { ...emptyMeta, spend: 100_000, cabinetSales: 1, cabinetRevenue: 50_000 };
    const totals = computeTotals(meta, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(totals.sales).toBe(1); // только cab-1
    expect(totals.revenue).toBe(50_000);
    expect(totals.cac).toBe(100_000);
  });
});

describe("Регрессия: orphan, оплаченный в периоде, но созданный раньше — попадает в продажи", () => {
  // Раньше Analytics/Metrics фильтровали orphan по createdAt, поэтому такой лид
  // показывал нулевую выручку при том, что Dashboard через useReportData
  // (по paid_at) корректно показывал её. Цифры между страницами не сходились.
  it("orphan создан в апреле, оплачен в мае → майские продажи = 1, выручка = amount", () => {
    const lead = mk({
      cabinetId: null,
      source: "whatsapp",
      createdAt: "2026-04-20T10:00:00Z",
      paidAt: "2026-05-15T10:00:00Z",
      lastActivityAt: "2026-05-15T10:00:00Z",
      paid: true,
      amount: 250_000,
    });
    const crm = aggregateCrm([lead], range, "all");
    const totals = computeTotals({ ...emptyMeta }, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(crm.orphanSales.length).toBe(1);
    expect(crm.orphanRevenue).toBe(250_000);
    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(250_000);
  });

  it("orphan создан в мае, оплачен в июне → май: лид=1, продажи=0", () => {
    const lead = mk({
      cabinetId: null,
      createdAt: "2026-05-20T10:00:00Z",
      paidAt: "2026-06-05T10:00:00Z",
      lastActivityAt: "2026-06-05T10:00:00Z",
      paid: true,
      amount: 250_000,
    });
    const crm = aggregateCrm([lead], range, "all");
    const totals = computeTotals({ ...emptyMeta }, crm, resolvedMetricsFromCrmAggregate(crm));

    expect(crm.orphanLeads.length).toBe(1); // как лид мая учитывается
    expect(crm.orphanSales.length).toBe(0); // но не как продажа мая
    expect(totals.sales).toBe(0);
  });
});
