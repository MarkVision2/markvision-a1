import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { factValue } from "@/lib/insightFacts";

export interface DailyInsightRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  revenue: number;
  diagnostics: number;
  manualDiagnostics: number;
  sales: number;
  manualSales: number;
  crmRevenue: number;
  manualRevenue: number;
}

export interface InsightTotals {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  revenue: number;
  cpl: number;
  cpm: number;
  cpc: number;
  ctr: number;
  romi: number;
  diagnostics: number;
  sales: number;
  crmRevenue: number;
}

export interface InsightsData {
  currency: string;
  totals: InsightTotals;
  daily: DailyInsightRow[];
}

const EMPTY_TOTALS: InsightTotals = {
  spend: 0, impressions: 0, clicks: 0, leads: 0, revenue: 0,
  cpl: 0, cpm: 0, cpc: 0, ctr: 0, romi: 0,
  diagnostics: 0, sales: 0, crmRevenue: 0,
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
  crm_diagnostics?: number;
  manual_diagnostics?: number;
  crm_sales?: number;
  manual_sales?: number;
  crm_revenue?: number | string;
  manual_revenue?: number | string;
}

function aggregate(rows: CdiRow[]): InsightsData {
  const dailyMap = new Map<string, DailyInsightRow>();
  const totals = { ...EMPTY_TOTALS };
  let currency = "USD";
  let totalCrmDiagnostics = 0;
  let totalManualDiagnostics = 0;
  let totalCrmSales = 0;
  let totalManualSales = 0;
  let totalCrmRevenue = 0;
  let totalManualRevenue = 0;
  for (const r of rows) {
    currency = r.currency || currency;
    const spend = Number(r.spend) || 0;
    const revenue = Number(r.revenue) || 0;
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const leads = Number(r.leads) || 0;
    const crmDiag = Number(r.crm_diagnostics) || 0;
    const manDiag = Number(r.manual_diagnostics) || 0;
    const diagnostics = factValue(crmDiag, manDiag);
    const crmSales = Number(r.crm_sales) || 0;
    const manSales = Number(r.manual_sales) || 0;
    const sales = factValue(crmSales, manSales);
    const crmRevenue = Number(r.crm_revenue) || 0;
    const manRevenue = Number(r.manual_revenue) || 0;
    const totalRevenue = factValue(crmRevenue, manRevenue);
    totals.spend += spend;
    totals.impressions += impressions;
    totals.clicks += clicks;
    totals.leads += leads;
    totals.revenue += revenue;
    totalCrmDiagnostics += crmDiag;
    totalManualDiagnostics += manDiag;
    totalCrmSales += crmSales;
    totalManualSales += manSales;
    totalCrmRevenue += crmRevenue;
    totalManualRevenue += manRevenue;
    const cur = dailyMap.get(r.date);
    if (cur) {
      cur.spend += spend;
      cur.impressions += impressions;
      cur.clicks += clicks;
      cur.leads += leads;
      cur.revenue += revenue;
      cur.diagnostics += diagnostics;
      cur.manualDiagnostics += manDiag;
      cur.sales += sales;
      cur.manualSales += manSales;
      cur.crmRevenue += totalRevenue;
      cur.manualRevenue += manRevenue;
    } else {
      dailyMap.set(r.date, {
        date: r.date, spend, impressions, clicks, leads, revenue,
        diagnostics, manualDiagnostics: manDiag,
        sales, manualSales: manSales,
        crmRevenue: totalRevenue, manualRevenue: manRevenue,
      });
    }
  }
  totals.diagnostics = factValue(totalCrmDiagnostics, totalManualDiagnostics);
  totals.sales = factValue(totalCrmSales, totalManualSales);
  totals.crmRevenue = factValue(totalCrmRevenue, totalManualRevenue);
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
  totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const effectiveRevenue = totals.crmRevenue;
  totals.romi = totals.spend > 0 ? ((effectiveRevenue - totals.spend) / totals.spend) * 100 : 0;
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  return { currency, totals, daily };
}

async function fetchInsights(actIds: string[], month: string): Promise<InsightsData> {
  const range = monthRange(month);
  if (!range || actIds.length === 0) {
    return { currency: "USD", totals: EMPTY_TOTALS, daily: [] };
  }
  const ids = actIds.map(normalizeActId);
  const { data, error } = await supabase
    .from("cabinet_daily_insights")
    .select("date, spend, impressions, clicks, leads, revenue, currency, crm_diagnostics, manual_diagnostics, crm_sales, manual_sales, crm_revenue, manual_revenue")
    .in("external_id", ids)
    .gte("date", range.since)
    .lte("date", range.until)
    .order("date", { ascending: true });
  if (error) throw new Error(error.message);
  return aggregate((data ?? []) as CdiRow[]);
}

export function useMetaInsights(
  actId: string | null | undefined,
  month: string,
  enabled = true,
) {
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
    fetchInsights([actId], month)
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
          fetchInsights([actId], month).then((d) => { if (!cancelled) setData(d); }).catch(() => {});
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [actId, month, enabled, refreshKey]);

  return { data, loading, error, refresh: () => setRefreshKey((k) => k + 1) };
}

export function useMultiMetaInsights(
  actIds: string[],
  month: string,
  enabled = true,
) {
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
    fetchInsights(actIds, month)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Неизвестная ошибка");
        setData({ currency: "USD", totals: EMPTY_TOTALS, daily: [] });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, month, enabled, refreshKey]);

  return { data, loading, error, refresh: () => setRefreshKey((k) => k + 1) };
}
