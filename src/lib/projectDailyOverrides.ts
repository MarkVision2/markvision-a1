import { supabase } from "@/integrations/supabase/client";
import type { LeadLite } from "@/hooks/useLeadsLite";
import { isManualOverrideActive, resolveCdiMetric } from "@/lib/cdiManualOverride";
import type { ReportPeriodRange } from "@/lib/crmDailyMetrics";
import {
  sumResolvedMetricsPerCabinets,
  type CdiFactRow,
  type ResolvedPeriodMetrics,
} from "@/lib/metricsSourceOfTruth";

/** Проектные ручные правки дня (rnp_daily, nullable override). */
export interface ProjectDailyOverride {
  date: string;
  manualSpend: number | null;
  manualLeads: number | null;
  manualCrmReceived: number | null;
  manualQualified: number | null;
  manualPlannedVisits: number | null;
  manualConductedVisits: number | null;
  manualDiagnosticsPaid: number | null;
  manualDiagnostics: number | null;
  manualDiagnosticRevenue: number | null;
  manualSales: number | null;
  manualSalesRevenue: number | null;
  manualCash: number | null;
  prepayCount: number;
  prepaySum: number;
}

export type ProjectDailyOverridePatch = Partial<{
  manual_spend: number | null;
  manual_leads: number | null;
  manual_crm_received: number | null;
  manual_qualified: number | null;
  manual_planned_visits: number | null;
  manual_conducted_visits: number | null;
  manual_diagnostics_paid: number | null;
  manual_diagnostics: number | null;
  manual_diagnostic_revenue: number | null;
  manual_sales: number | null;
  manual_sales_revenue: number | null;
  manual_cash: number | null;
  prepayments_count: number;
  prepayments_sum: number;
}>;

const RNP_SELECT_LEGACY =
  "id,date,prepayments_count,prepayments_sum";

const RNP_SELECT_FULL =
  `${RNP_SELECT_LEGACY},manual_spend,manual_leads,manual_crm_received,manual_qualified,` +
  "manual_planned_visits,manual_conducted_visits,manual_diagnostics_paid,manual_diagnostics," +
  "manual_diagnostic_revenue,manual_sales,manual_sales_revenue,manual_cash";

function rnpMissingManualColumns(message: string): boolean {
  return /manual_spend|manual_crm_received|manual_sales/i.test(message);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mapRow(r: Record<string, unknown>): ProjectDailyOverride {
  const numOrNull = (k: string) => {
    const v = r[k];
    return isManualOverrideActive(v as number | null) ? Math.max(0, Number(v) || 0) : null;
  };
  return {
    date: String(r.date),
    manualSpend: numOrNull("manual_spend"),
    manualLeads: numOrNull("manual_leads"),
    manualCrmReceived: numOrNull("manual_crm_received"),
    manualQualified: numOrNull("manual_qualified"),
    manualPlannedVisits: numOrNull("manual_planned_visits"),
    manualConductedVisits: numOrNull("manual_conducted_visits"),
    manualDiagnosticsPaid: numOrNull("manual_diagnostics_paid"),
    manualDiagnostics: numOrNull("manual_diagnostics"),
    manualDiagnosticRevenue: numOrNull("manual_diagnostic_revenue"),
    manualSales: numOrNull("manual_sales"),
    manualSalesRevenue: numOrNull("manual_sales_revenue"),
    manualCash: numOrNull("manual_cash"),
    prepayCount: Number(r.prepayments_count ?? 0),
    prepaySum: Number(r.prepayments_sum ?? 0),
  };
}

export async function fetchProjectDailyOverrides(
  range: ReportPeriodRange,
  projectId: string | null,
): Promise<Map<string, ProjectDailyOverride>> {
  const since = ymd(range.from);
  const until = ymd(range.to);

  const run = async (cols: string) => {
    let q = (supabase as any)
      .from("rnp_daily")
      .select(cols)
      .gte("date", since)
      .lte("date", until);
    if (projectId) q = q.or(`project_id.eq.${projectId},project_id.is.null`);
    return q;
  };

  let res = await run(RNP_SELECT_FULL);
  if (res.error && rnpMissingManualColumns(res.error.message)) {
    res = await run(RNP_SELECT_LEGACY);
  }
  if (res.error) {
    if (/rnp_daily/i.test(res.error.message)) return new Map();
    throw new Error(res.error.message);
  }
  const m = new Map<string, ProjectDailyOverride>();
  for (const row of res.data ?? []) m.set(String(row.date), mapRow(row as Record<string, unknown>));
  return m;
}

/** Применить проектный override к авто-значениям дня (для «все кабинеты»). */
export function applyProjectDailyOverride(
  auto: {
    spend: number;
    leads: number;
    crmReceived: number;
    qualified: number;
    plannedVisits: number;
    conductedVisits: number;
    diagnosticsPaid: number;
    diagnostics: number;
    diagnosticRevenue: number;
    sales: number;
    salesRevenue: number;
    cashRevenue: number;
    prepayCount: number;
    prepaySum: number;
  },
  o: ProjectDailyOverride | undefined,
) {
  if (!o) return auto;
  return {
    spend: resolveCdiMetric(o.manualSpend, auto.spend),
    leads: resolveCdiMetric(o.manualLeads, auto.leads),
    crmReceived: resolveCdiMetric(o.manualCrmReceived, auto.crmReceived),
    qualified: resolveCdiMetric(o.manualQualified, auto.qualified),
    plannedVisits: resolveCdiMetric(o.manualPlannedVisits, auto.plannedVisits),
    conductedVisits: resolveCdiMetric(o.manualConductedVisits, auto.conductedVisits),
    diagnosticsPaid: resolveCdiMetric(o.manualDiagnosticsPaid, auto.diagnosticsPaid),
    diagnostics: resolveCdiMetric(o.manualDiagnostics, auto.diagnostics),
    diagnosticRevenue: resolveCdiMetric(o.manualDiagnosticRevenue, auto.diagnosticRevenue),
    sales: resolveCdiMetric(o.manualSales, auto.sales),
    salesRevenue: resolveCdiMetric(o.manualSalesRevenue, auto.salesRevenue),
    cashRevenue: resolveCdiMetric(o.manualCash, auto.cashRevenue),
    prepayCount: o.prepayCount > 0 ? o.prepayCount : auto.prepayCount,
    prepaySum: o.prepaySum > 0 ? o.prepaySum : auto.prepaySum,
  };
}

export function shouldUseProjectDailyOverrides(
  cabinetId: string,
  cabinetsWithExternalId: number,
): boolean {
  return cabinetId === "all" && cabinetsWithExternalId > 1;
}

/** Пересчёт отчёта с проектными override (режим «все кабинеты»). */
export function rebuildReportWithProjectOverrides(
  range: ReportPeriodRange,
  meta: {
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    daily: { date: string; spend: number; leads: number; revenue: number }[];
  },
  resolved: ResolvedPeriodMetrics,
  leads: LeadLite[],
  cdiFactRows: CdiFactRow[],
  cabinetInternalIds: string[],
  includeOrphans: boolean,
  externalIdByCabinetId: Map<string, string>,
  projectOverrides: Map<string, ProjectDailyOverride>,
): {
  meta: typeof meta;
  resolved: ResolvedPeriodMetrics;
  monthlyMeta: { date: string; spend: number; leads: number; revenue: number }[];
} {
  const dailyByDate = new Map(meta.daily.map((d) => [d.date, d]));
  const acc: ResolvedPeriodMetrics = {
    diagnostics: 0,
    diagnosticRevenue: 0,
    sales: 0,
    salesRevenue: 0,
    revenue: 0,
  };
  let spend = 0;
  let leadsSum = 0;
  const monthlyMeta: { date: string; spend: number; leads: number; revenue: number }[] = [];

  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
  while (cur.getTime() <= end.getTime()) {
    const iso = ymd(cur);
    const md = dailyByDate.get(iso);
    const dayRange = { from: new Date(cur), to: new Date(cur) };
    const dayRes = sumResolvedMetricsPerCabinets(
      dayRange, leads, cdiFactRows, cabinetInternalIds, includeOrphans, externalIdByCabinetId,
    );
    const merged = applyProjectDailyOverride(
      {
        spend: md?.spend ?? 0,
        leads: md?.leads ?? 0,
        crmReceived: 0,
        qualified: 0,
        plannedVisits: 0,
        conductedVisits: 0,
        diagnosticsPaid: 0,
        diagnostics: dayRes.diagnostics,
        diagnosticRevenue: dayRes.diagnosticRevenue,
        sales: dayRes.sales,
        salesRevenue: dayRes.salesRevenue,
        cashRevenue: 0,
        prepayCount: 0,
        prepaySum: 0,
      },
      projectOverrides.get(iso),
    );
    spend += merged.spend;
    leadsSum += merged.leads;
    acc.diagnostics += merged.diagnostics;
    acc.diagnosticRevenue += merged.diagnosticRevenue;
    acc.sales += merged.sales;
    acc.salesRevenue += merged.salesRevenue;
    acc.revenue += merged.salesRevenue + merged.diagnosticRevenue;
    monthlyMeta.push({
      date: iso,
      spend: merged.spend,
      leads: merged.leads,
      revenue: merged.salesRevenue + merged.diagnosticRevenue,
    });
    cur.setDate(cur.getDate() + 1);
  }

  return {
    meta: { ...meta, spend, leads: leadsSum, daily: monthlyMeta },
    resolved: acc,
    monthlyMeta,
  };
}
