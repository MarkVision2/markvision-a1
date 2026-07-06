import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { CDI_SELECT_WITH_AD_MANUAL, fetchCdiRows } from "@/lib/cdiFetch";
import { isManualOverrideActive, resolveCdiMetric } from "@/lib/cdiManualOverride";

export interface DailyInsightRow {
  date: string;
  spend: number;
  /** Meta/CDI до проектного override. */
  autoSpend: number;
  manualSpend: number;
  manualSpendRaw: number | null;
  impressions: number;
  clicks: number;
  leads: number;
  autoLeads: number;
  manualLeads: number;
  manualLeadsRaw: number | null;
  /** FB pixel revenue. НЕ используется для бизнес-выручки — это событийная атрибуция. */
  pixelRevenue: number;
  /** @deprecated alias на pixelRevenue для обратной совместимости. */
  revenue: number;
  /** Override-результат: manual если задан, иначе crm. */
  diagnostics: number;
  /** Чистое CRM значение, без manual override (для отображения «Из CRM: N» в попапах). */
  crmDiagnostics: number;
  manualDiagnostics: number;
  /** NULL = авто из CRM; число (включая 0) = ручная корректировка. */
  manualDiagnosticsRaw: number | null;
  /** Override: оплаты за диагностику ₸. */
  diagnosticRevenue: number;
  crmDiagnosticRevenue: number;
  manualDiagnosticRevenue: number;
  /** Override-результат: manual если задан, иначе crm. */
  sales: number;
  crmSales: number;
  manualSales: number;
  manualSalesRaw: number | null;
  /** Override-результат: только выручка ПРОДАЖ (без диагностик). */
  salesRevenue: number;
  crmSalesRevenueOnly: number;
  manualSalesRevenue: number;
  manualSalesRevenueRaw: number | null;
  /**
   * ИТОГОВАЯ выручка дня = salesRevenue + diagnosticRevenue (override-aware).
   * Это «выручка факт» — единый источник правды для денег.
   */
  crmRevenue: number;
  crmRevenueOnly: number;
  manualRevenue: number;
  manualDiagnosticRevenueRaw: number | null;
  /** Лидов получено в CRM (created_at). */
  crmReceived: number;
  autoCrmReceived: number;
  manualCrmReceivedRaw: number | null;
  /** Квал. лиды (скоринг Green API >= порога). */
  qualified: number;
  autoQualified: number;
  manualQualifiedRaw: number | null;
  /** Предоплат получено, шт (ручной ввод, rnp_daily). */
  prepayCount: number;
  /** Сумма предоплат ₸ (ручной ввод, rnp_daily). */
  prepaySum: number;
  /** Запланировано визитов на день (next_visit_at). */
  plannedVisits: number;
  autoPlannedVisits: number;
  manualPlannedVisitsRaw: number | null;
  /** Проведено визитов (факт). */
  conductedVisits: number;
  autoConductedVisits: number;
  manualConductedVisitsRaw: number | null;
  /** Оплачено диагностик, шт (diagnostic_amount > 0). */
  diagnosticsPaid: number;
  autoDiagnosticsPaid: number;
  manualDiagnosticsPaidRaw: number | null;
  /** Сумма оплат диагностик из CRM (auto). */
  diagnosticRevenuePaid: number;
  /** Наличные за день ₸. */
  cashRevenue: number;
  autoCashRevenue: number;
  manualCashRaw: number | null;
}

export interface InsightTotals {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  /** FB pixel revenue. Не используется в KPI выручки. */
  pixelRevenue: number;
  /** @deprecated alias на pixelRevenue. */
  revenue: number;
  cpl: number;
  cpm: number;
  cpc: number;
  ctr: number;
  romi: number;
  diagnostics: number;
  diagnosticRevenue: number;
  sales: number;
  salesRevenue: number;
  /** Override-aware: продажи + оплаты диагностик. Это «выручка факт» в Metrics/Analytics/Dashboard. */
  crmRevenue: number;
}

export interface InsightsData {
  currency: string;
  totals: InsightTotals;
  daily: DailyInsightRow[];
}

const RNP_DAY_ZERO = {
  autoSpend: 0,
  manualSpend: 0,
  manualSpendRaw: null as number | null,
  autoLeads: 0,
  manualLeads: 0,
  manualLeadsRaw: null as number | null,
  autoCrmReceived: 0,
  manualCrmReceivedRaw: null as number | null,
  autoQualified: 0,
  manualQualifiedRaw: null as number | null,
  autoPlannedVisits: 0,
  manualPlannedVisitsRaw: null as number | null,
  autoConductedVisits: 0,
  manualConductedVisitsRaw: null as number | null,
  autoDiagnosticsPaid: 0,
  manualDiagnosticsPaidRaw: null as number | null,
  autoCashRevenue: 0,
  manualCashRaw: null as number | null,
  crmReceived: 0,
  qualified: 0,
  prepayCount: 0,
  prepaySum: 0,
  plannedVisits: 0,
  conductedVisits: 0,
  diagnosticsPaid: 0,
  diagnosticRevenuePaid: 0,
  cashRevenue: 0,
} as const;

const EMPTY_TOTALS: InsightTotals = {
  spend: 0, impressions: 0, clicks: 0, leads: 0, pixelRevenue: 0, revenue: 0,
  cpl: 0, cpm: 0, cpc: 0, ctr: 0, romi: 0,
  diagnostics: 0, diagnosticRevenue: 0, sales: 0, salesRevenue: 0, crmRevenue: 0,
};

function normalizeActId(id: string) {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

function monthRange(month: string): { since: string; until: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const idx = Number(m[2]) - 1;
  const first = new Date(Date.UTC(year, idx, 1));
  const last = new Date(Date.UTC(year, idx + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(first), until: fmt(last) };
}

interface CdiRow {
  date: string;
  spend: number | string;
  impressions: number;
  clicks: number;
  leads: number;
  revenue: number | string;
  currency: string;
  manual_spend?: number | string | null;
  manual_leads?: number | string | null;
  crm_diagnostics?: number;
  manual_diagnostics?: number;
  crm_sales?: number;
  manual_sales?: number;
  crm_revenue?: number | string;
  manual_revenue?: number | string;
  crm_diagnostic_revenue?: number | string;
  manual_diagnostic_revenue?: number | string;
}

function aggregate(rows: CdiRow[]): InsightsData {
  const dailyMap = new Map<string, DailyInsightRow>();
  const totals = { ...EMPTY_TOTALS };
  let currency = "USD";
  for (const r of rows) {
    currency = r.currency || currency;
    const autoSpendVal = Number(r.spend) || 0;
    const autoLeadsVal = Number(r.leads) || 0;
    const spend = resolveCdiMetric(r.manual_spend, autoSpendVal);
    const pixelRevenue = Number(r.revenue) || 0;
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const leads = resolveCdiMetric(r.manual_leads, autoLeadsVal);
    // Override-семантика: ручные значения ПЕРЕЗАПИСЫВАЮТ CRM, а не суммируются с ним.
    // Раньше складывали (crm + manual) — это приводило к задвоению, когда менеджер вводил
    // 400к manual поверх 800к из CRM и получал 1.2М вместо 800к. См. жалобу пользователя.
    const crmDiag = Number(r.crm_diagnostics) || 0;
    const diagnostics = resolveCdiMetric(r.manual_diagnostics, crmDiag);
    const crmSales = Number(r.crm_sales) || 0;
    const sales = resolveCdiMetric(r.manual_sales, crmSales);
    const crmSalesRev = Number(r.crm_revenue) || 0;
    const salesRevenue = resolveCdiMetric(r.manual_revenue, crmSalesRev);
    const crmDiagRev = Number(r.crm_diagnostic_revenue) || 0;
    const diagnosticRevenue = resolveCdiMetric(
      r.manual_diagnostic_revenue,
      crmDiagRev,
    );
    const manDiag = isManualOverrideActive(r.manual_diagnostics)
      ? Math.max(0, Number(r.manual_diagnostics) || 0)
      : 0;
    const manSales = isManualOverrideActive(r.manual_sales)
      ? Math.max(0, Number(r.manual_sales) || 0)
      : 0;
    const manSalesRev = isManualOverrideActive(r.manual_revenue)
      ? Math.max(0, Number(r.manual_revenue) || 0)
      : 0;
    const manDiagRev = isManualOverrideActive(r.manual_diagnostic_revenue)
      ? Math.max(0, Number(r.manual_diagnostic_revenue) || 0)
      : 0;
    // Итоговая «выручка факт» = продажи + оплаты диагностик. Override-семантика
    // применяется внутри каждой составляющей, потом суммируется.
    const totalRevenue = salesRevenue + diagnosticRevenue;
    totals.spend += spend;
    totals.impressions += impressions;
    totals.clicks += clicks;
    totals.leads += leads;
    totals.pixelRevenue += pixelRevenue;
    totals.revenue += pixelRevenue;
    totals.diagnostics += diagnostics;
    totals.diagnosticRevenue += diagnosticRevenue;
    totals.sales += sales;
    totals.salesRevenue += salesRevenue;
    totals.crmRevenue += totalRevenue;
    const cur = dailyMap.get(r.date);
    if (cur) {
      cur.autoSpend = (cur.autoSpend ?? 0) + autoSpendVal;
      cur.spend += spend;
      if (isManualOverrideActive(r.manual_spend)) {
        cur.manualSpendRaw = Number(r.manual_spend);
      }
      cur.autoLeads = (cur.autoLeads ?? 0) + autoLeadsVal;
      cur.impressions += impressions;
      cur.clicks += clicks;
      cur.leads += leads;
      if (isManualOverrideActive(r.manual_leads)) {
        cur.manualLeadsRaw = Number(r.manual_leads);
      }
      cur.pixelRevenue += pixelRevenue;
      cur.revenue += pixelRevenue;
      cur.diagnostics += diagnostics;
      cur.crmDiagnostics += crmDiag;
      cur.manualDiagnostics += manDiag;
      if (isManualOverrideActive(r.manual_diagnostics)) {
        cur.manualDiagnosticsRaw = Number(r.manual_diagnostics);
      }
      cur.diagnosticRevenue += diagnosticRevenue;
      cur.crmDiagnosticRevenue += crmDiagRev;
      cur.manualDiagnosticRevenue += manDiagRev;
      cur.sales += sales;
      cur.crmSales += crmSales;
      cur.manualSales += manSales;
      if (isManualOverrideActive(r.manual_sales)) {
        cur.manualSalesRaw = Number(r.manual_sales);
      }
      cur.salesRevenue += salesRevenue;
      cur.crmSalesRevenueOnly += crmSalesRev;
      cur.manualSalesRevenue += manSalesRev;
      if (isManualOverrideActive(r.manual_revenue)) {
        cur.manualSalesRevenueRaw = Number(r.manual_revenue);
      }
      cur.crmRevenue += totalRevenue;
      cur.crmRevenueOnly += crmSalesRev + crmDiagRev;
      cur.manualRevenue += manSalesRev + manDiagRev;
      if (isManualOverrideActive(r.manual_diagnostic_revenue)) {
        cur.manualDiagnosticRevenueRaw = Number(r.manual_diagnostic_revenue);
      }
    } else {
      dailyMap.set(r.date, {
        date: r.date, spend, autoSpend: autoSpendVal, manualSpend: 0,
        manualSpendRaw: isManualOverrideActive(r.manual_spend) ? Number(r.manual_spend) : null,
        impressions, clicks, leads, autoLeads: autoLeadsVal, manualLeads: 0,
        manualLeadsRaw: isManualOverrideActive(r.manual_leads) ? Number(r.manual_leads) : null,
        pixelRevenue, revenue: pixelRevenue,
        diagnostics, crmDiagnostics: crmDiag, manualDiagnostics: manDiag,
        manualDiagnosticsRaw: isManualOverrideActive(r.manual_diagnostics) ? Number(r.manual_diagnostics) : null,
        diagnosticRevenue, crmDiagnosticRevenue: crmDiagRev, manualDiagnosticRevenue: manDiagRev,
        manualDiagnosticRevenueRaw: isManualOverrideActive(r.manual_diagnostic_revenue) ? Number(r.manual_diagnostic_revenue) : null,
        sales, crmSales, manualSales: manSales,
        manualSalesRaw: isManualOverrideActive(r.manual_sales) ? Number(r.manual_sales) : null,
        salesRevenue, crmSalesRevenueOnly: crmSalesRev, manualSalesRevenue: manSalesRev,
        manualSalesRevenueRaw: isManualOverrideActive(r.manual_revenue) ? Number(r.manual_revenue) : null,
        crmRevenue: totalRevenue,
        crmRevenueOnly: crmSalesRev + crmDiagRev,
        manualRevenue: manSalesRev + manDiagRev,
        ...RNP_DAY_ZERO,
      });
    }
  }
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  // ROMI считается строго по реальной выручке (CRM/manual), без FB pixel fallback.
  // Это даёт ту же ROMI на Dashboard/Reports/Analytics/Metrics для одного периода.
  totals.romi = totals.spend > 0 ? ((totals.crmRevenue - totals.spend) / totals.spend) * 100 : 0;
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  return { currency, totals, daily };
}

async function fetchInsights(
  actIds: string[],
  month: string,
  projectId?: string | null,
): Promise<InsightsData> {
  const range = monthRange(month);
  if (!range || actIds.length === 0) {
    return { currency: "USD", totals: EMPTY_TOTALS, daily: [] };
  }
  const ids = actIds.map(normalizeActId);
  const data = await fetchCdiRows<CdiRow>(CDI_SELECT_WITH_AD_MANUAL, {
    externalIds: ids,
    since: range.since,
    until: range.until,
    projectId,
    order: true,
  });
  return aggregate(data);
}

export function useMetaInsights(
  actId: string | null | undefined,
  month: string,
  enabled = true,
) {
  const { activeId: projectId } = useProjectsStore();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled || !actId || !month) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchInsights([actId], month, projectId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Неизвестная ошибка");
        setData({ currency: "USD", totals: EMPTY_TOTALS, daily: [] });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    // Realtime: subscribe to changes in cabinet_daily_insights for this external_id
    const norm = normalizeActId(actId);
    const channel = supabase
      .channel(`cdi-${norm}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cabinet_daily_insights", filter: `external_id=eq.${norm}` },
        () => {
          fetchInsights([actId], month, projectId)
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) console.warn("[useMetaInsights] realtime refetch failed", e); });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [actId, month, enabled, refreshKey, projectId]);

  return { data, loading, error, refresh: () => setRefreshKey((k) => k + 1) };
}

export function useMultiMetaInsights(
  actIds: string[],
  month: string,
  enabled = true,
) {
  const { activeId: projectId } = useProjectsStore();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const key = actIds.join(",");

  useEffect(() => {
    if (!enabled || actIds.length === 0) {
      setData({ currency: "USD", totals: EMPTY_TOTALS, daily: [] });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchInsights(actIds, month, projectId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Неизвестная ошибка");
        setData({ currency: "USD", totals: EMPTY_TOTALS, daily: [] });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, month, enabled, refreshKey, projectId]);

  return { data, loading, error, refresh: () => setRefreshKey((k) => k + 1) };
}
