import type { DailyInsightRow } from "@/hooks/useMetaInsights";
import { resolveCdiMetric } from "@/lib/cdiManualOverride";
import type { RnpDailyMetrics } from "@/lib/metricsRnpDaily";

export interface MetricsDayMoney {
  diagnosticsPaid: number;
  diagnosticsPaidAuto: number;
  manualDiagnosticsRaw: number | null;
  manualDiagnostics: number;
  diagnosticRevenuePaid: number;
  diagnosticRevenueAuto: number;
  manualDiagnosticRevenueRaw: number | null;
  manualDiagnosticRevenue: number;
  sales: number;
  salesAuto: number;
  manualSalesRaw: number | null;
  manualSales: number;
  salesRevenue: number;
  salesRevenueAuto: number;
  manualSalesRevenueRaw: number | null;
  manualSalesRevenue: number;
}

const emptyRnp = (): RnpDailyMetrics => ({
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
});

/** Деньги в Metrics: авто из rnp (лиды), ручные из CDI. */
export function resolveMetricsDayMoney(
  ins: DailyInsightRow | undefined,
  rnp: RnpDailyMetrics | undefined,
  allCabinets: boolean,
): MetricsDayMoney {
  const auto = rnp ?? emptyRnp();
  const manualDiagRaw = ins?.manualDiagnosticsRaw ?? null;
  const manualDiagRevRaw = ins?.manualDiagnosticRevenueRaw ?? null;
  const manualSalesRaw = ins?.manualSalesRaw ?? null;
  const manualSalesRevRaw = ins?.manualSalesRevenueRaw ?? null;

  if (allCabinets && ins) {
    return {
      diagnosticsPaid: ins.diagnostics,
      diagnosticsPaidAuto: auto.diagnosticsPaid,
      manualDiagnosticsRaw: manualDiagRaw,
      manualDiagnostics: ins.manualDiagnostics,
      diagnosticRevenuePaid: ins.diagnosticRevenue,
      diagnosticRevenueAuto: auto.diagnosticRevenuePaid,
      manualDiagnosticRevenueRaw: manualDiagRevRaw,
      manualDiagnosticRevenue: ins.manualDiagnosticRevenue,
      sales: ins.sales,
      salesAuto: auto.sales,
      manualSalesRaw,
      manualSales: ins.manualSales,
      salesRevenue: ins.salesRevenue,
      salesRevenueAuto: auto.salesRevenue,
      manualSalesRevenueRaw: manualSalesRevRaw,
      manualSalesRevenue: ins.manualSalesRevenue,
    };
  }

  return {
    diagnosticsPaid: resolveCdiMetric(manualDiagRaw, auto.diagnosticsPaid),
    diagnosticsPaidAuto: auto.diagnosticsPaid,
    manualDiagnosticsRaw: manualDiagRaw,
    manualDiagnostics: ins?.manualDiagnostics ?? 0,
    diagnosticRevenuePaid: resolveCdiMetric(manualDiagRevRaw, auto.diagnosticRevenuePaid),
    diagnosticRevenueAuto: auto.diagnosticRevenuePaid,
    manualDiagnosticRevenueRaw: manualDiagRevRaw,
    manualDiagnosticRevenue: ins?.manualDiagnosticRevenue ?? 0,
    sales: resolveCdiMetric(manualSalesRaw, auto.sales),
    salesAuto: auto.sales,
    manualSalesRaw,
    manualSales: ins?.manualSales ?? 0,
    salesRevenue: resolveCdiMetric(manualSalesRevRaw, auto.salesRevenue),
    salesRevenueAuto: auto.salesRevenue,
    manualSalesRevenueRaw: manualSalesRevRaw,
    manualSalesRevenue: ins?.manualSalesRevenue ?? 0,
  };
}
