import type { CrmDailyMetrics } from "@/hooks/useReportData";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { isManualOverrideActive, resolveCdiMetric } from "@/lib/cdiManualOverride";

/** Ручные поля CDI на один день (NULL = авто из CRM). */
export interface DayManualFields {
  manual_diagnostics: number | null;
  manual_diagnostic_revenue: number | null;
  manual_sales: number | null;
  manual_revenue: number | null;
}

export interface ResolvedDayMetrics {
  diagnostics: number;
  diagnosticRevenue: number;
  sales: number;
  salesRevenue: number;
  revenue: number;
}

export interface ResolvedPeriodMetrics extends ResolvedDayMetrics {}

const EMPTY_DAY_MANUAL: DayManualFields = {
  manual_diagnostics: null,
  manual_diagnostic_revenue: null,
  manual_sales: null,
  manual_revenue: null,
};

const EMPTY_RESOLVED: ResolvedDayMetrics = {
  diagnostics: 0,
  diagnosticRevenue: 0,
  sales: 0,
  salesRevenue: 0,
  revenue: 0,
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Как в Metrics: ручная правка только при одном кабинете в контексте. */
export function shouldApplyManualOverrides(
  cabinetId: string,
  cabinetsWithExternalId: number,
): boolean {
  return cabinetId !== "all" || cabinetsWithExternalId === 1;
}

type CdiManualRow = {
  date: string;
  manual_diagnostics?: number | string | null;
  manual_diagnostic_revenue?: number | string | null;
  manual_sales?: number | string | null;
  manual_revenue?: number | string | null;
};

/** Собирает manual_* по дням из строк CDI (один кабинет → одна строка на дату). */
export function aggregateCdiManualByDay(rows: CdiManualRow[]): Map<string, DayManualFields> {
  const m = new Map<string, DayManualFields>();
  for (const row of rows) {
    m.set(row.date, {
      manual_diagnostics: isManualOverrideActive(row.manual_diagnostics)
        ? Number(row.manual_diagnostics) || 0
        : null,
      manual_diagnostic_revenue: isManualOverrideActive(row.manual_diagnostic_revenue)
        ? Number(row.manual_diagnostic_revenue) || 0
        : null,
      manual_sales: isManualOverrideActive(row.manual_sales)
        ? Number(row.manual_sales) || 0
        : null,
      manual_revenue: isManualOverrideActive(row.manual_revenue)
        ? Number(row.manual_revenue) || 0
        : null,
    });
  }
  return m;
}

/** Один день: live CRM + optional manual override (как dailyMap в Metrics). */
export function resolveDayMetrics(
  crm: CrmDailyMetrics | undefined,
  manual: DayManualFields | undefined,
  applyManual: boolean,
): ResolvedDayMetrics {
  const crmDiag = crm?.diagnostics ?? 0;
  const crmDiagRev = crm?.diagnosticRevenue ?? 0;
  const crmSales = crm?.sales ?? 0;
  const crmSalesRev = crm?.salesRevenue ?? 0;

  const man = manual ?? EMPTY_DAY_MANUAL;
  const manualDiagRaw = applyManual ? man.manual_diagnostics : null;
  const manualDiagRevRaw = applyManual ? man.manual_diagnostic_revenue : null;
  const manualSalesRaw = applyManual ? man.manual_sales : null;
  const manualSalesRevRaw = applyManual ? man.manual_revenue : null;

  const diagnostics = resolveCdiMetric(manualDiagRaw, crmDiag);
  const diagnosticRevenue = resolveCdiMetric(manualDiagRevRaw, crmDiagRev);
  const sales = resolveCdiMetric(manualSalesRaw, crmSales);
  const salesRevenue = resolveCdiMetric(manualSalesRevRaw, crmSalesRev);

  return {
    diagnostics,
    diagnosticRevenue,
    sales,
    salesRevenue,
    revenue: salesRevenue + diagnosticRevenue,
  };
}

/** Сумма по всем дням периода — итоги Таблицы показателей. */
export function sumResolvedMetricsForRange(
  range: ReportPeriodRange,
  crmByDay: Map<string, CrmDailyMetrics>,
  manualByDay: Map<string, DayManualFields>,
  applyManual: boolean,
): ResolvedPeriodMetrics {
  const acc = { ...EMPTY_RESOLVED };
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());

  while (cur.getTime() <= end.getTime()) {
    const iso = ymd(cur);
    const day = resolveDayMetrics(crmByDay.get(iso), manualByDay.get(iso), applyManual);
    acc.diagnostics += day.diagnostics;
    acc.diagnosticRevenue += day.diagnosticRevenue;
    acc.sales += day.sales;
    acc.salesRevenue += day.salesRevenue;
    acc.revenue += day.revenue;
    cur.setDate(cur.getDate() + 1);
  }
  return acc;
}

/** Для тестов: CRM-агрегат без ручных правок (эквивалент пустого manualByDay). */
export function resolvedMetricsFromCrmAggregate(crm: {
  crmVisitsCount: number;
  crmDiagnosticRevenue: number;
  crmSalesCount: number;
  crmRevenue: number;
}): ResolvedPeriodMetrics {
  return {
    diagnostics: crm.crmVisitsCount,
    diagnosticRevenue: crm.crmDiagnosticRevenue,
    sales: crm.crmSalesCount,
    salesRevenue: crm.crmRevenue,
    revenue: crm.crmRevenue + crm.crmDiagnosticRevenue,
  };
}

/** Дневной ряд выручки для графиков Dashboard/Analytics. */
export function buildResolvedDailyRevenue(
  range: ReportPeriodRange,
  crmByDay: Map<string, CrmDailyMetrics>,
  manualByDay: Map<string, DayManualFields>,
  applyManual: boolean,
): Map<string, number> {
  const revByDay = new Map<string, number>();
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());

  while (cur.getTime() <= end.getTime()) {
    const iso = ymd(cur);
    const day = resolveDayMetrics(crmByDay.get(iso), manualByDay.get(iso), applyManual);
    revByDay.set(iso, day.revenue);
    cur.setDate(cur.getDate() + 1);
  }
  return revByDay;
}
