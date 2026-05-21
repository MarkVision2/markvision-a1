import { describe, it, expect } from "vitest";
import { computeTotals, aggregateCrm } from "@/hooks/useReportData";
import type { LeadLite } from "@/hooks/useLeadsLite";

const mk = (over: Partial<LeadLite> = {}): LeadLite => ({
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

describe("Сквозная воронка: рекламный кабинет → CRM → таблица показателей", () => {
  it("воронка из 5 лидов с 3 диагностиками и 1 продажей считается верно", () => {
    // 5 заявок с meta_ad_id (учитываются через CDI)
    const meta = { ...emptyMeta,
      spend: 200_000, impressions: 50_000, clicks: 1_500, leads: 5,
      cabinetDiagnostics: 3, cabinetDiagnosticRevenue: 15_000,
      cabinetSales: 1, cabinetRevenue: 150_000,
    };
    const crm = aggregateCrm([], range, "all");
    const totals = computeTotals(meta, crm);

    expect(totals.adsLeads).toBe(5);
    expect(totals.totalLeads).toBe(5);
    expect(totals.visits).toBe(3); // диагностики
    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(165_000); // 15k диаг + 150k продажа
    expect(totals.cpl).toBe(40_000); // 200k / 5
    expect(totals.cpv).toBeCloseTo(66666.67, 1); // 200k / 3 (стоимость диагностики)
    expect(totals.cac).toBe(200_000); // 200k / 1
    expect(totals.aov).toBe(165_000);
    expect(totals.romi).toBeLessThan(0); // расход больше выручки
  });

  it("orphan заявка через WhatsApp с оплатой включается в итоги", () => {
    const orphanWhatsApp = mk({
      source: "whatsapp",
      cabinetId: null,
      paid: true,
      amount: 100_000,
      createdAt: "2026-05-15T10:00:00Z",
    });
    const meta = { ...emptyMeta, spend: 50_000, leads: 2, cabinetSales: 1, cabinetRevenue: 50_000 };
    const crm = aggregateCrm([orphanWhatsApp], range, "all");
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(2); // 1 из CDI + 1 orphan
    expect(totals.revenue).toBe(150_000); // 50k + 100k
    expect(totals.cac).toBe(25_000); // 50k / 2
    expect(totals.totalLeads).toBe(3); // 2 ads + 1 orphan
  });

  it("CR воронки: лид → диагностика → продажа", () => {
    const meta = { ...emptyMeta,
      leads: 10, cabinetDiagnostics: 5, cabinetSales: 2, cabinetRevenue: 200_000,
    };
    const crm = aggregateCrm([], range, "all");
    const totals = computeTotals(meta, crm);

    const crLeadDiag = totals.totalLeads > 0 ? (totals.visits / totals.totalLeads) * 100 : 0;
    const crDiagSale = totals.visits > 0 ? (totals.sales / totals.visits) * 100 : 0;
    const crLeadSale = totals.totalLeads > 0 ? (totals.sales / totals.totalLeads) * 100 : 0;

    expect(crLeadDiag).toBe(50); // 5/10
    expect(crDiagSale).toBe(40); // 2/5
    expect(crLeadSale).toBe(20); // 2/10
  });

  it("стоимость лида / диагностики / клиента считаются на одних и тех же продажах", () => {
    // Paid orphan автоматически = +1 visit (isLeadVisit: paid → true)
    const orphan = mk({ paid: true, amount: 100_000 });
    const meta = { ...emptyMeta,
      spend: 600_000, leads: 6, cabinetDiagnostics: 2, cabinetSales: 1,
    };
    const crm = aggregateCrm([orphan], range, "all");
    const totals = computeTotals(meta, crm);

    expect(totals.totalLeads).toBe(7); // 6 + 1 orphan
    expect(totals.cpl).toBeCloseTo(600_000 / 7, 1);
    expect(totals.visits).toBe(3); // 2 CDI + 1 orphan-visit (paid → visit)
    expect(totals.cpv).toBe(200_000); // 600k / 3 диагностики
    expect(totals.cac).toBe(300_000); // 600k / 2 продажи (1 CDI + 1 orphan)
  });

  it("плательщик включён только один раз даже если paid=true и в paid stage", () => {
    const lead = mk({ paid: true, stageKey: "paid", amount: 50_000 });
    const crm = aggregateCrm([lead], range, "all");

    expect(crm.orphanSales.length).toBe(1); // только 1 раз
    expect(crm.orphanRevenue).toBe(50_000);
  });

  it("ROMI правильно считается с выручкой включая orphan", () => {
    const orphan = mk({ paid: true, amount: 500_000 });
    const crm = aggregateCrm([orphan], range, "all");
    const meta = { ...emptyMeta, spend: 400_000, cabinetSales: 1, cabinetRevenue: 300_000 };
    const totals = computeTotals(meta, crm);

    // выручка = 300k + 500k = 800k
    // ROMI = (800k - 400k) / 400k * 100 = 100%
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
    const totals = computeTotals(meta, crm);

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
    const totals = computeTotals(meta, crm);

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
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(3); // CRM = 3, max(1+0, 3) = 3
    expect(totals.revenue).toBe(450_000); // CRM revenue = 100+200+150
  });

  it("3 диагностики в CRM, но CDI показывает только 1 — берём CRM", () => {
    const scheduled1 = mk({ cabinetId: "cab-1", stageKey: "scheduled", lastActivityAt: "2026-05-10T10:00:00Z" });
    const scheduled2 = mk({ cabinetId: "cab-1", stageKey: "visit", lastActivityAt: "2026-05-12T10:00:00Z" });
    const scheduledOrphan = mk({ cabinetId: null, stageKey: "scheduled", lastActivityAt: "2026-05-15T10:00:00Z" });
    const crm = aggregateCrm([scheduled1, scheduled2, scheduledOrphan], range, "all");
    const meta = { ...emptyMeta, spend: 200_000, cabinetDiagnostics: 1 };
    const totals = computeTotals(meta, crm);

    expect(totals.visits).toBe(3); // CRM = 3, max(1+1, 3) = 3
  });

  it("manual_sales в CDI больше, чем CRM (offline-продажи) — берём CDI+orphan", () => {
    // Бизнес ввёл +5 оффлайн-продаж через manual_sales в Metrics.
    // CRM при этом имеет только 1 paid лид.
    const cabPaid = mk({ cabinetId: "cab-1", paid: true, amount: 100_000 });
    const crm = aggregateCrm([cabPaid], range, "all");
    // CDI: manual_sales override превратил это в 5 (1 CRM + 4 offline)
    const meta = { ...emptyMeta, spend: 200_000, cabinetSales: 5, cabinetRevenue: 500_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(5); // CDI+orphan = 5+0 = 5, CRM = 1, max = 5
    expect(totals.revenue).toBe(500_000); // CDI revenue
  });

  it("стандартный случай: CDI и CRM согласованы (нет потерь)", () => {
    const cab1 = mk({ cabinetId: "cab-1", paid: true, amount: 100_000 });
    const cab2 = mk({ cabinetId: "cab-1", paid: true, amount: 200_000 });
    const orphan = mk({ cabinetId: null, paid: true, amount: 50_000 });
    const crm = aggregateCrm([cab1, cab2, orphan], range, "all");
    const meta = { ...emptyMeta, cabinetSales: 2, cabinetRevenue: 300_000 }; // CDI знает про 2 cab

    const totals = computeTotals(meta, crm);
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

  it("при выборе кабинета итоги = только CDI выбранного кабинета", () => {
    const orphan = mk({ paid: true, amount: 200_000 });
    const crm = aggregateCrm([orphan], range, "cab-1");
    const meta = { ...emptyMeta, spend: 100_000, cabinetSales: 1, cabinetRevenue: 50_000 };
    const totals = computeTotals(meta, crm);

    expect(totals.sales).toBe(1);
    expect(totals.revenue).toBe(50_000);
    expect(totals.cac).toBe(100_000);
  });
});
