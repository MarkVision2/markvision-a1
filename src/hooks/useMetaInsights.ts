import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface DailyInsightRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  /** FB pixel revenue. НЕ используется для бизнес-выручки — это событийная атрибуция. */
  pixelRevenue: number;
  /** @deprecated alias на pixelRevenue для обратной совместимости. */
  revenue: number;
  /** Override-результат: manual если задан, иначе crm. */
  diagnostics: number;
  /** Чистое CRM значение, без manual override (для отображения «Из CRM: N» в попапах). */
  crmDiagnostics: number;
  manualDiagnostics: number;
  /** Override: оплаты за диагностику ₸. */
  diagnosticRevenue: number;
  crmDiagnosticRevenue: number;
  manualDiagnosticRevenue: number;
  /** Override-результат: manual если задан, иначе crm. */
  sales: number;
  crmSales: number;
  manualSales: number;
  /** Override-результат: только выручка ПРОДАЖ (без диагностик). */
  salesRevenue: number;
  crmSalesRevenueOnly: number;
  manualSalesRevenue: number;
  /**
   * ИТОГОВАЯ выручка дня = salesRevenue + diagnosticRevenue (override-aware).
   * Это «выручка факт» — единый источник правды для денег.
   */
  crmRevenue: number;
  crmRevenueOnly: number;
  manualRevenue: number;
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
  crm_diagnostics?: number | null;
  manual_diagnostics?: number | null;
  crm_sales?: number | null;
  manual_sales?: number | null;
  crm_revenue?: number | string | null;
  manual_revenue?: number | string | null;
  crm_diagnostic_revenue?: number | string | null;
  manual_diagnostic_revenue?: number | string | null;
}

// Override-семантика по NULL: если manual_* установлен (даже 0) — он перезаписывает
// CRM. Если NULL/undefined — берётся CRM. Раньше было `> 0`, и невозможно было
// явно поставить «по факту 0» (получался автоматический возврат к CRM).
const overrideNum = (manual: number | string | null | undefined, crm: number | string | null | undefined): number => {
  if (manual !== null && manual !== undefined && manual !== "") return Number(manual) || 0;
  return Number(crm) || 0;
};

function aggregate(rows: CdiRow[]): InsightsData {
  const dailyMap = new Map<string, DailyInsightRow>();
  const totals = { ...EMPTY_TOTALS };
  let currency = "USD";
  for (const r of rows) {
    currency = r.currency || currency;
    const spend = Number(r.spend) || 0;
    const pixelRevenue = Number(r.revenue) || 0;
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const leads = Number(r.leads) || 0;
    // Override-семантика: ручные значения ПЕРЕЗАПИСЫВАЮТ CRM, а не суммируются с ним.
    // Раньше складывали (crm + manual) — это приводило к задвоению, когда менеджер вводил
    // 400к manual поверх 800к из CRM и получал 1.2М вместо 800к. См. жалобу пользователя.
    const crmDiag = Number(r.crm_diagnostics) || 0;
    const manDiag = Number(r.manual_diagnostics) || 0;
    const diagnostics = manDiag > 0 ? manDiag : crmDiag;
    const crmSales = Number(r.crm_sales) || 0;
    const manSales = Number(r.manual_sales) || 0;
    const sales = manSales > 0 ? manSales : crmSales;
    const crmSalesRev = Number(r.crm_revenue) || 0;
    const manSalesRev = Number(r.manual_revenue) || 0;
    const salesRevenue = manSalesRev > 0 ? manSalesRev : crmSalesRev;
    const crmDiagRev = Number(r.crm_diagnostic_revenue) || 0;
    const manDiagRev = Number(r.manual_diagnostic_revenue) || 0;
    const diagnosticRevenue = manDiagRev > 0 ? manDiagRev : crmDiagRev;
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
      cur.spend += spend;
      cur.impressions += impressions;
      cur.clicks += clicks;
      cur.leads += leads;
      cur.pixelRevenue += pixelRevenue;
      cur.revenue += pixelRevenue;
      cur.diagnostics += diagnostics;
      cur.crmDiagnostics += crmDiag;
      cur.manualDiagnostics += manDiag;
      cur.diagnosticRevenue += diagnosticRevenue;
      cur.crmDiagnosticRevenue += crmDiagRev;
      cur.manualDiagnosticRevenue += manDiagRev;
      cur.sales += sales;
      cur.crmSales += crmSales;
      cur.manualSales += manSales;
      cur.salesRevenue += salesRevenue;
      cur.crmSalesRevenueOnly += crmSalesRev;
      cur.manualSalesRevenue += manSalesRev;
      cur.crmRevenue += totalRevenue;
      cur.crmRevenueOnly += crmSalesRev + crmDiagRev;
      cur.manualRevenue += manSalesRev + manDiagRev;
    } else {
      dailyMap.set(r.date, {
        date: r.date, spend, impressions, clicks, leads,
        pixelRevenue, revenue: pixelRevenue,
        diagnostics, crmDiagnostics: crmDiag, manualDiagnostics: manDiag,
        diagnosticRevenue, crmDiagnosticRevenue: crmDiagRev, manualDiagnosticRevenue: manDiagRev,
        sales, crmSales, manualSales: manSales,
        salesRevenue, crmSalesRevenueOnly: crmSalesRev, manualSalesRevenue: manSalesRev,
        crmRevenue: totalRevenue,
        crmRevenueOnly: crmSalesRev + crmDiagRev,
        manualRevenue: manSalesRev + manDiagRev,
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
  let q = supabase
    .from("cabinet_daily_insights")
    .select("date, spend, impressions, clicks, leads, revenue, currency, crm_diagnostics, manual_diagnostics, crm_sales, manual_sales, crm_revenue, manual_revenue, crm_diagnostic_revenue, manual_diagnostic_revenue")
    .in("external_id", ids)
    .gte("date", range.since)
    .lte("date", range.until)
    .order("date", { ascending: true });
  // Изоляция проекта: если несколько проектов делили один external_id (миграция кабинета и т.п.),
  // чужие строки в выборку не попадут.
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return aggregate((data ?? []) as CdiRow[]);
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
