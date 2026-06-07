import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useLeadsLite, type LeadLite } from "@/hooks/useLeadsLite";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { normalizeSource } from "@/lib/leadSource";
import { isLeadDiagnosticEvent, isLeadPaid } from "@/lib/leadStageFlags";
import { resolveCdiMetric } from "@/lib/cdiManualOverride";
import {
  aggregateCdiManualByDay,
  buildResolvedDailyRevenue,
  shouldApplyManualOverrides,
  sumResolvedMetricsForRange,
  type ResolvedPeriodMetrics,
} from "@/lib/metricsSourceOfTruth";

export interface ReportPeriodRange {
  from: Date;
  to: Date;
}

export interface ReportTotals {
  spend: number;
  impressions: number;
  clicks: number;
  adsLeads: number;
  crmLeads: number;
  totalLeads: number;
  visits: number;
  sales: number;
  revenue: number;
  cpl: number;
  cpv: number; // cost per visit
  cac: number; // customer acquisition cost
  ctr: number;
  romi: number;
  aov: number;
}

export interface ReportCreative {
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface ReportChannel {
  name: string;
  leads: number;
  share: number;
}

export interface ReportScoring {
  hot: number;
  warm: number;
  cold: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
}

export interface ReportData {
  totals: ReportTotals;
  prev?: ReportTotals;
  creatives: ReportCreative[];
  channels: ReportChannel[];
  scoring: ReportScoring;
  monthlyMeta: { date: string; spend: number; leads: number; revenue: number }[];
}

const EMPTY_TOTALS: ReportTotals = {
  spend: 0, impressions: 0, clicks: 0, adsLeads: 0, crmLeads: 0,
  totalLeads: 0, visits: 0, sales: 0, revenue: 0,
  cpl: 0, cpv: 0, cac: 0, ctr: 0, romi: 0, aov: 0,
};

function daysBetween(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function shiftRange({ from, to }: ReportPeriodRange): ReportPeriodRange {
  const days = daysBetween(from, to);
  const newTo = new Date(from);
  newTo.setDate(newTo.getDate() - 1);
  const newFrom = new Date(newTo);
  newFrom.setDate(newFrom.getDate() - days + 1);
  return { from: newFrom, to: newTo };
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeActId(id: string) {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

/**
 * Единый источник правды по фактам Meta — таблица cabinet_daily_insights.
 * Заполняется ежедневно cron-задачей `meta-daily-sync-1am`.
 */
async function fetchMetaForRange(
  externalIds: string[],
  range: ReportPeriodRange,
  projectId?: string | null,
): Promise<{
  spend: number; impressions: number; clicks: number; leads: number;
  cabinetSales: number; cabinetRevenue: number; cabinetDiagnostics: number;
  cabinetDiagnosticRevenue: number;
  manualByDay: ReturnType<typeof aggregateCdiManualByDay>;
  daily: { date: string; spend: number; leads: number; revenue: number }[];
}> {
  if (externalIds.length === 0) {
    return {
      spend: 0, impressions: 0, clicks: 0, leads: 0,
      cabinetSales: 0, cabinetRevenue: 0, cabinetDiagnostics: 0, cabinetDiagnosticRevenue: 0,
      manualByDay: new Map(),
      daily: [],
    };
  }
  const ids = externalIds.map(normalizeActId);
  const since = ymd(range.from);
  const until = ymd(range.to);

  let q = supabase
    .from("cabinet_daily_insights")
    .select("date, spend, impressions, clicks, leads, crm_sales, manual_sales, crm_revenue, manual_revenue, crm_diagnostics, manual_diagnostics, crm_diagnostic_revenue, manual_diagnostic_revenue")
    .in("external_id", ids)
    .gte("date", since)
    .lte("date", until);
  // Изолируем по проекту, чтобы цифры совпадали с useDashboardData / useMonthlyAggregates,
  // которые тоже фильтруют по project_id.
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const dailyAgg = new Map<string, { spend: number; leads: number; revenue: number }>();
  let totSpend = 0, totImp = 0, totClicks = 0, totLeads = 0;
  let totSales = 0, totRevenue = 0, totDiag = 0, totDiagRev = 0;

  for (const row of data ?? []) {
    const spend = Number(row.spend) || 0;
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const leads = Number(row.leads) || 0;
    // Override-семантика: manual_* перезаписывает crm_* (а не суммируется).
    // Раньше складывали → задвоение, когда оба источника содержат одну и ту же продажу.
    const crmSales = Number(row.crm_sales) || 0;
    const sales = resolveCdiMetric(row.manual_sales, crmSales);
    const crmRev = Number(row.crm_revenue) || 0;
    const revenue = resolveCdiMetric(row.manual_revenue, crmRev);
    const crmDiag = Number(row.crm_diagnostics) || 0;
    const diag = resolveCdiMetric(row.manual_diagnostics, crmDiag);
    const crmDiagRev = Number((row as { crm_diagnostic_revenue?: number }).crm_diagnostic_revenue) || 0;
    const diagRev = resolveCdiMetric(
      (row as { manual_diagnostic_revenue?: number | null }).manual_diagnostic_revenue,
      crmDiagRev,
    );
    totSpend += spend; totImp += impressions; totClicks += clicks; totLeads += leads;
    totSales += sales; totRevenue += revenue; totDiag += diag; totDiagRev += diagRev;
    const cur = dailyAgg.get(row.date) ?? { spend: 0, leads: 0, revenue: 0 };
    cur.spend += spend;
    cur.leads += leads;
    cur.revenue += revenue + diagRev;
    dailyAgg.set(row.date, cur);
  }

  const manualByDay = aggregateCdiManualByDay(
    (data ?? []).map((row) => ({
      date: row.date,
      manual_diagnostics: row.manual_diagnostics,
      manual_diagnostic_revenue: (row as { manual_diagnostic_revenue?: number | null }).manual_diagnostic_revenue,
      manual_sales: row.manual_sales,
      manual_revenue: row.manual_revenue,
    })),
  );

  return {
    spend: totSpend,
    impressions: totImp,
    clicks: totClicks,
    leads: totLeads,
    cabinetSales: totSales,
    cabinetRevenue: totRevenue,
    cabinetDiagnostics: totDiag,
    cabinetDiagnosticRevenue: totDiagRev,
    manualByDay,
    daily: Array.from(dailyAgg.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export interface CrmDailyMetrics {
  diagnostics: number;
  diagnosticRevenue: number;
  sales: number;
  salesRevenue: number;
}

/** CRM-факты по дням (источник правды для диагностик/продаж в Таблице показателей). */
export function crmDailyMetrics(
  leads: LeadLite[],
  range: ReportPeriodRange,
  cabinetSelector: "all" | string,
): Map<string, CrmDailyMetrics> {
  const fromTs = range.from.getTime();
  const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
  const matchCabinet = (l: LeadLite) =>
    cabinetSelector === "all" || l.cabinetId === cabinetSelector;
  const empty = (): CrmDailyMetrics => ({
    diagnostics: 0,
    diagnosticRevenue: 0,
    sales: 0,
    salesRevenue: 0,
  });
  const m = new Map<string, CrmDailyMetrics>();

  for (const l of leads) {
    if (!matchCabinet(l)) continue;
    if (isLeadDiagnosticEvent(l)) {
      const ref = l.lastActivityAt ?? l.createdAt;
      const t = new Date(ref).getTime();
      if (t >= fromTs && t < toTs) {
        const key = ref.slice(0, 10);
        const cur = m.get(key) ?? empty();
        cur.diagnostics += 1;
        cur.diagnosticRevenue += l.diagnosticAmount || 0;
        m.set(key, cur);
      }
    }
    if (isLeadPaid(l)) {
      const ref = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(ref).getTime();
      if (t >= fromTs && t < toTs) {
        const key = ref.slice(0, 10);
        const cur = m.get(key) ?? empty();
        cur.sales += 1;
        cur.salesRevenue += l.amount || 0;
        m.set(key, cur);
      }
    }
  }
  return m;
}

export function aggregateCrm(
  leads: LeadLite[],
  range: ReportPeriodRange,
  cabinetSelector: "all" | string,
) {
  const fromTs = range.from.getTime();
  const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
  const matchCabinet = (l: LeadLite) =>
    cabinetSelector === "all" || l.cabinetId === cabinetSelector;

  const inRange = leads.filter((l) => {
    if (!matchCabinet(l)) return false;
    const t = new Date(l.createdAt).getTime();
    return t >= fromTs && t < toTs;
  });
  // Продажи — по paid_at (как CDI). Лид создан в апреле, оплачен в мае — попадает в май.
  const paidInRange = leads.filter((l) => {
    if (!isLeadPaid(l)) return false;
    if (!matchCabinet(l)) return false;
    const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
    const t = new Date(paidAt).getTime();
    return t >= fromTs && t < toTs;
  });
  // Диагностики — по дате события; оплаченная продажа не считается диагностикой.
  const visitedInRange = leads.filter((l) => {
    if (!isLeadDiagnosticEvent(l)) return false;
    if (!matchCabinet(l)) return false;
    const ref = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
    const t = new Date(ref).getTime();
    return t >= fromTs && t < toTs;
  });
  // Полные CRM-метрики (источник правды): включают ВСЕ лиды — и с cabinet_id, и без.
  // Эти числа = «как считает CRM», поэтому Funnel/Dashboard/Reports/Metrics показывают
  // одно и то же. Даже если CDI-триггер пропустил продажу, CRM покажет её всё равно.
  const crmSalesCount = paidInRange.length;
  const crmRevenue = paidInRange.reduce((s, l) => s + (l.amount || 0), 0);
  const crmVisitsCount = visitedInRange.length;
  const crmDiagnosticRevenue = visitedInRange.reduce((s, l) => s + (l.diagnosticAmount || 0), 0);

  // Orphan — для legacy совместимости (используется в некоторых старых местах).
  const orphanLeads = cabinetSelector === "all"
    ? inRange.filter((l) => !l.cabinetId)
    : [];
  const orphanVisits = cabinetSelector === "all"
    ? visitedInRange.filter((l) => !l.cabinetId)
    : [];
  const orphanSales = cabinetSelector === "all"
    ? paidInRange.filter((l) => !l.cabinetId)
    : [];
  const orphanRevenue = orphanSales.reduce((s, l) => s + (l.amount || 0), 0);
  return {
    leads: inRange,
    // Новые поля: полная CRM-картина
    crmSalesCount,
    crmRevenue,
    crmVisitsCount,
    crmDiagnosticRevenue,
    // Legacy: orphan-only (для совместимости)
    orphanLeads,
    orphanVisits,
    orphanSales,
    orphanRevenue,
  };
}

export function computeTotals(
  meta: { spend: number; impressions: number; clicks: number; leads: number },
  crm: {
    leads: LeadLite[];
    orphanLeads: LeadLite[];
  },
  resolved: ResolvedPeriodMetrics,
): ReportTotals {
  // Единый источник правды = Таблица показателей:
  // live CRM по дням (crmDailyMetrics) + ручные manual_* из CDI.
  // CDI здесь только для рекламных метрик (расход/клики/показы/Meta-лиды).
  const orphanLeadsCount = crm.orphanLeads.length;

  const totalLeads = meta.leads + orphanLeadsCount;
  const cpl = totalLeads > 0 ? meta.spend / totalLeads : 0;

  const visits = resolved.diagnostics;
  const sales = resolved.sales;
  const revenue = resolved.revenue;
  const cpv = visits > 0 ? meta.spend / visits : 0;
  const cac = sales > 0 ? meta.spend / sales : 0;
  const ctr = meta.impressions > 0 ? (meta.clicks / meta.impressions) * 100 : 0;
  const romi = meta.spend > 0 ? ((revenue - meta.spend) / meta.spend) * 100 : revenue > 0 ? 100 : 0;
  const aov = sales > 0 ? revenue / sales : 0;
  return {
    spend: meta.spend,
    impressions: meta.impressions,
    clicks: meta.clicks,
    adsLeads: meta.leads,
    crmLeads: crm.leads.length,
    totalLeads,
    visits,
    sales,
    revenue,
    cpl, cpv, cac, ctr, romi, aov,
  };
}

function computeScoring(leadList: LeadLite[]): ReportScoring {
  // ai_score not loaded by lite hook (saves a column). Default everyone to "warm".
  return {
    hot: 0,
    warm: leadList.length > 0 ? 100 : 0,
    cold: 0,
    hotLeads: 0,
    warmLeads: leadList.length,
    coldLeads: 0,
  };
}

function computeChannels(leadList: LeadLite[]): ReportChannel[] {
  const map = new Map<string, number>();
  for (const l of leadList) {
    const meta = normalizeSource(l.source);
    const k = meta.key === "unknown" && meta.raw ? meta.raw : meta.label;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  const total = leadList.length || 1;
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, leads: count, share: (count / total) * 100 }))
    .sort((a, b) => b.leads - a.leads);
}

export function useReportData(
  cabinetId: string,
  range: ReportPeriodRange,
  compare: boolean,
) {
  const { leads } = useLeadsLite();
  // Только Личные кабинеты активного проекта попадают в аналитику.
  const { cabinets } = usePersonalCabinets();
  const { activeId: projectId } = useProjectsStore();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useRealtimeTable("cabinet_daily_insights", () => setTick((t) => t + 1), true, 800);

  const cabinetIds = useMemo(() => {
    if (cabinetId === "all") return cabinets.map((c) => c.externalId).filter(Boolean);
    const cab = cabinets.find((c) => c.id === cabinetId);
    return cab?.externalId ? [cab.externalId] : [];
  }, [cabinetId, cabinets]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const cabinetSelector: "all" | string = cabinetId === "all" ? "all" : cabinetId;
        const applyManual = shouldApplyManualOverrides(cabinetId, cabinetIds.length);
        const meta = await fetchMetaForRange(cabinetIds, range, projectId);
        const crm = aggregateCrm(leads, range, cabinetSelector);
        const crmByDay = crmDailyMetrics(leads, range, cabinetSelector);
        const resolved = sumResolvedMetricsForRange(
          range, crmByDay, meta.manualByDay, applyManual,
        );
        const totals = computeTotals(meta, crm, resolved);
        const scoring = computeScoring(crm.leads);
        const channels = computeChannels(crm.leads);
        const creatives: ReportCreative[] = []; // ad-level not yet exposed by edge fn

        const revByDay = buildResolvedDailyRevenue(
          range, crmByDay, meta.manualByDay, applyManual,
        );
        const spendLeadsByDay = new Map(
          meta.daily.map((d) => [d.date, { spend: d.spend, leads: d.leads }]),
        );
        const monthlyMeta: { date: string; spend: number; leads: number; revenue: number }[] = [];
        const cur = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
        const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
        while (cur.getTime() <= end.getTime()) {
          const k = ymd(cur);
          const sl = spendLeadsByDay.get(k);
          monthlyMeta.push({
            date: k,
            spend: sl?.spend ?? 0,
            leads: sl?.leads ?? 0,
            revenue: revByDay.get(k) ?? 0,
          });
          cur.setDate(cur.getDate() + 1);
        }

        let prev: ReportTotals | undefined;
        if (compare) {
          const prevRange = shiftRange(range);
          const prevMeta = await fetchMetaForRange(cabinetIds, prevRange, projectId);
          const prevCrm = aggregateCrm(leads, prevRange, cabinetSelector);
          const prevCrmByDay = crmDailyMetrics(leads, prevRange, cabinetSelector);
          const prevResolved = sumResolvedMetricsForRange(
            prevRange, prevCrmByDay, prevMeta.manualByDay, applyManual,
          );
          prev = computeTotals(prevMeta, prevCrm, prevResolved);
        }

        if (cancelled) return;
        setData({ totals, prev, creatives, channels, scoring, monthlyMeta });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
        setData({
          totals: EMPTY_TOTALS, creatives: [], channels: computeChannels([]),
          scoring: computeScoring([]), monthlyMeta: [],
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cabinetIds.join(","), range.from.getTime(), range.to.getTime(), compare, leads.length, tick, projectId]);

  return { data, loading, error };
}

export function deltaPct(cur: number, prev?: number): number | null {
  if (prev === undefined) return null;
  if (prev === 0) return cur === 0 ? 0 : 100;
  return ((cur - prev) / prev) * 100;
}