import { crmDailyMetrics, type CrmDailyMetrics, type ReportPeriodRange } from "@/lib/crmDailyMetrics";
import type { LeadLite } from "@/hooks/useLeadsLite";
import { isManualOverrideActive, resolveCdiMetric } from "@/lib/cdiManualOverride";

function manualDiagApplied(manual: DayManualFields | undefined): boolean {
  return (
    isManualOverrideActive(manual?.manual_diagnostics)
    || isManualOverrideActive(manual?.manual_diagnostic_revenue)
  );
}

/** Ручные поля CDI на один день (NULL = авто из CRM). */
export interface DayManualFields {
  manual_diagnostics: number | null;
  manual_diagnostic_revenue: number | null;
  manual_sales: number | null;
  manual_revenue: number | null;
}

export interface CdiFactRow extends DayManualFields {
  date: string;
  cabinet_id?: string | null;
  external_id?: string | null;
}

function rowHasManual(row: CdiFactRow): boolean {
  return (
    isManualOverrideActive(row.manual_diagnostics)
    || isManualOverrideActive(row.manual_diagnostic_revenue)
    || isManualOverrideActive(row.manual_sales)
    || isManualOverrideActive(row.manual_revenue)
  );
}

/** CDI-строка для кабинета: по cabinet_id, иначе external_id, иначе единственная строка дня. */
export function findCdiRowForCabinet(
  cdiRows: CdiFactRow[],
  iso: string,
  cabId: string,
  externalId: string | null | undefined,
  scopedCabinetIds: string[],
): CdiFactRow | undefined {
  const dayRows = cdiRows.filter((r) => r.date === iso);
  const byCabinet = dayRows.find((r) => r.cabinet_id === cabId);
  if (byCabinet) return byCabinet;

  if (externalId) {
    const norm = externalId.trim();
    const byExternal = dayRows.find((r) => {
      const ext = (r.external_id ?? "").trim();
      return ext === norm || ext.replace(/^act_/i, "") === norm.replace(/^act_/i, "");
    });
    if (byExternal) return byExternal;
  }

  if (scopedCabinetIds.length === 1 && scopedCabinetIds[0] === cabId) {
    if (dayRows.length === 1) return dayRows[0];
    const nullManual = dayRows.find((r) => !r.cabinet_id && rowHasManual(r));
    if (nullManual) return nullManual;
  }

  return undefined;
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

function singleDayRange(iso: string): ReportPeriodRange {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  return { from: day, to: day };
}

function addResolved(acc: ResolvedDayMetrics, day: ResolvedDayMetrics): void {
  acc.diagnostics += day.diagnostics;
  acc.diagnosticRevenue += day.diagnosticRevenue;
  acc.sales += day.sales;
  acc.salesRevenue += day.salesRevenue;
  acc.revenue += day.revenue;
}

/** Только UI Metrics: можно ли редактировать manual в таблице. */
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

export function manualFieldsFromCdiRow(row: CdiManualRow | undefined): DayManualFields | undefined {
  if (!row) return undefined;
  return {
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
  };
}

/** @deprecated Используйте per-cabinet агрегацию. Оставлено для обратной совместимости тестов. */
export function aggregateCdiManualByDay(rows: CdiManualRow[]): Map<string, DayManualFields> {
  const m = new Map<string, DayManualFields>();
  for (const row of rows) {
    m.set(row.date, manualFieldsFromCdiRow(row) ?? EMPTY_DAY_MANUAL);
  }
  return m;
}

/** Один день: live CRM + manual override из CDI (всегда читаем manual, если задан). */
export function resolveDayMetrics(
  crm: CrmDailyMetrics | undefined,
  manual: DayManualFields | undefined,
  applyManual = true,
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

/**
 * Итоги периода — как Таблица показателей: день × кабинет,
 * live CRM + manual через findCdiRowForCabinet (как в Metrics).
 */
export function sumResolvedMetricsPerCabinets(
  range: ReportPeriodRange,
  leads: LeadLite[],
  cdiRows: CdiFactRow[],
  cabinetInternalIds: string[],
  includeOrphans: boolean,
  externalIdByCabinetId?: Map<string, string>,
): ResolvedPeriodMetrics {
  const acc = { ...EMPTY_RESOLVED };
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
  const orphanLeads = includeOrphans ? leads.filter((l) => !l.cabinetId) : [];

  while (cur.getTime() <= end.getTime()) {
    const iso = ymd(cur);
    const dayRange = singleDayRange(iso);

    let manualDiagAppliedOnDay = false;
    for (const cabId of cabinetInternalIds) {
      const externalId = externalIdByCabinetId?.get(cabId) ?? null;
      const cdiRow = findCdiRowForCabinet(cdiRows, iso, cabId, externalId, cabinetInternalIds);
      const manual = manualFieldsFromCdiRow(cdiRow);
      if (manualDiagApplied(manual)) manualDiagAppliedOnDay = true;
      const crm = crmDailyMetrics(leads, dayRange, cabId).get(iso);
      addResolved(acc, resolveDayMetrics(crm, manual, true));
    }

    // Orphan-CRM не дублируем только если manual override реально применился к кабинету.
    if (includeOrphans && !manualDiagAppliedOnDay) {
      const crm = crmDailyMetrics(orphanLeads, dayRange, "all").get(iso);
      addResolved(acc, resolveDayMetrics(crm, undefined, true));
    }

    cur.setDate(cur.getDate() + 1);
  }

  return acc;
}

/** Выручка по дням — та же day × cabinet логика. */
export function buildResolvedDailyRevenuePerCabinets(
  range: ReportPeriodRange,
  leads: LeadLite[],
  cdiRows: CdiFactRow[],
  cabinetInternalIds: string[],
  includeOrphans: boolean,
  externalIdByCabinetId?: Map<string, string>,
): Map<string, number> {
  const revByDay = new Map<string, number>();
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
  const orphanLeads = includeOrphans ? leads.filter((l) => !l.cabinetId) : [];

  while (cur.getTime() <= end.getTime()) {
    const iso = ymd(cur);
    const dayRange = singleDayRange(iso);
    let revenue = 0;

    let manualDiagAppliedOnDay = false;
    for (const cabId of cabinetInternalIds) {
      const externalId = externalIdByCabinetId?.get(cabId) ?? null;
      const cdiRow = findCdiRowForCabinet(cdiRows, iso, cabId, externalId, cabinetInternalIds);
      const manual = manualFieldsFromCdiRow(cdiRow);
      if (manualDiagApplied(manual)) manualDiagAppliedOnDay = true;
      const crm = crmDailyMetrics(leads, dayRange, cabId).get(iso);
      revenue += resolveDayMetrics(crm, manual, true).revenue;
    }

    if (includeOrphans && !manualDiagAppliedOnDay) {
      const crm = crmDailyMetrics(orphanLeads, dayRange, "all").get(iso);
      revenue += resolveDayMetrics(crm, undefined, true).revenue;
    }

    revByDay.set(iso, revenue);
    cur.setDate(cur.getDate() + 1);
  }
  return revByDay;
}

/** @deprecated */
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
    addResolved(acc, day);
    cur.setDate(cur.getDate() + 1);
  }
  return acc;
}

/** Для тестов: CRM-агрегат без ручных правок. */
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

/** @deprecated */
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
