import { describe, it, expect } from "vitest";
import { resolveMetricsDayMoney } from "@/lib/metricsDayMoney";
import type { DailyInsightRow } from "@/hooks/useMetaInsights";

function ins(partial: Partial<DailyInsightRow> & Pick<DailyInsightRow, "date">): DailyInsightRow {
  return {
    date: partial.date,
    spend: 0,
    autoSpend: 0,
    manualSpend: 0,
    manualSpendRaw: null,
    impressions: 0,
    linkClicks: 0,
    messages: 0,
    clicks: 0,
    leads: 0,
    autoLeads: 0,
    manualLeads: 0,
    manualLeadsRaw: null,
    pixelRevenue: 0,
    revenue: 0,
    diagnostics: 0,
    crmDiagnostics: 0,
    manualDiagnostics: 0,
    manualDiagnosticsRaw: null,
    diagnosticRevenue: 0,
    crmDiagnosticRevenue: 0,
    manualDiagnosticRevenue: 0,
    manualDiagnosticRevenueRaw: null,
    sales: 0,
    crmSales: 0,
    manualSales: 0,
    manualSalesRaw: null,
    salesRevenue: 0,
    crmSalesRevenueOnly: 0,
    manualSalesRevenue: 0,
    manualSalesRevenueRaw: null,
    crmRevenue: 0,
    crmRevenueOnly: 0,
    manualRevenue: 0,
    crmReceived: 0,
    autoCrmReceived: 0,
    manualCrmReceivedRaw: null,
    joins: 0,
    qualified: 0,
    autoQualified: 0,
    manualQualifiedRaw: null,
    prepayCount: 0,
    prepaySum: 0,
    plannedVisits: 0,
    autoPlannedVisits: 0,
    manualPlannedVisitsRaw: null,
    conductedVisits: 0,
    autoConductedVisits: 0,
    manualConductedVisitsRaw: null,
    diagnosticsPaid: 0,
    autoDiagnosticsPaid: 0,
    manualDiagnosticsPaidRaw: null,
    diagnosticRevenuePaid: 0,
    cashRevenue: 0,
    autoCashRevenue: 0,
    manualCashRaw: null,
    ...partial,
  };
}

describe("resolveMetricsDayMoney", () => {
  it("один кабинет: manual_revenue перезаписывает авто из rnp", () => {
    const m = resolveMetricsDayMoney(
      ins({ date: "2026-06-05", manualSalesRevenueRaw: 700000 }),
      {
        crmReceived: 0,
        qualified: 0,
        joins: 0,
        plannedVisits: 0,
        conductedVisits: 0,
        scheduled: 0,
        conducted: 0,
        diagnosticsPaid: 0,
        diagnosticRevenuePaid: 0,
        sales: 0,
        salesRevenue: 0,
        cashRevenue: 0,
      },
      false,
    );
    expect(m.salesRevenue).toBe(700000);
  });

  it("все кабинеты: берёт агрегат из CDI", () => {
    const m = resolveMetricsDayMoney(
      ins({ date: "2026-06-05", salesRevenue: 700000, sales: 1 }),
      undefined,
      true,
    );
    expect(m.salesRevenue).toBe(700000);
    expect(m.sales).toBe(1);
  });
});
