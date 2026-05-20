import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useLeadsLite, type LeadLite } from "@/hooks/useLeadsLite";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { normalizeSource } from "@/lib/leadSource";
import { factValue } from "@/lib/insightFacts";

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
): Promise<{
  spend: number; impressions: number; clicks: number; leads: number;
  cabinetSales: number; cabinetRevenue: number; cabinetDiagnostics: number;
  hasManualSales: boolean; hasManualRevenue: boolean; hasManualDiagnostics: boolean;
  daily: { date: string; spend: number; leads: number; revenue: number }[];
}> {
  if (externalIds.length === 0) {
    return {
      spend: 0, impressions: 0, clicks: 0, leads: 0,
      cabinetSales: 0, cabinetRevenue: 0, cabinetDiagnostics: 0,
      hasManualSales: false, hasManualRevenue: false, hasManualDiagnostics: false,
      daily: [],
    };
  }
  const ids = externalIds.map(normalizeActId);
  const since = ymd(range.from);
  const until = ymd(range.to);

  const { data, error } = await supabase
    .from("cabinet_daily_insights")
    .select("date, external_id, cabinet_id, spend, impressions, clicks, leads, crm_sales, manual_sales, crm_revenue, manual_revenue, crm_diagnostics, manual_diagnostics")
    .in("external_id", ids)
    .gte("date", since)
    .lte("date", until);
  if (error) throw new Error(error.message);

  const dailyAgg = new Map<string, { spend: number; leads: number; revenue: number }>();
  const cabinetFacts = new Map<string, {
    crmSales: number; manualSales: number;
    crmRevenue: number; manualRevenue: number;
    crmDiagnostics: number; manualDiagnostics: number;
  }>();
  let totSpend = 0, totImp = 0, totClicks = 0, totLeads = 0;

  const rows = data ?? [];
  for (const row of rows) {
    const spend = Number(row.spend) || 0;
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const leads = Number(row.leads) || 0;
    const crmSales = Number(row.crm_sales) || 0;
    const manualSales = Number(row.manual_sales) || 0;
    const crmRevenue = Number(row.crm_revenue) || 0;
    const manualRevenue = Number(row.manual_revenue) || 0;
    const crmDiagnostics = Number(row.crm_diagnostics) || 0;
    const manualDiagnostics = Number(row.manual_diagnostics) || 0;
    totSpend += spend; totImp += impressions; totClicks += clicks; totLeads += leads;
    const cabinetKey = row.external_id || row.cabinet_id || "__unknown__";
    const facts = cabinetFacts.get(cabinetKey) ?? {
      crmSales: 0, manualSales: 0,
      crmRevenue: 0, manualRevenue: 0,
      crmDiagnostics: 0, manualDiagnostics: 0,
    };
    facts.crmSales += crmSales;
    facts.manualSales += manualSales;
    facts.crmRevenue += crmRevenue;
    facts.manualRevenue += manualRevenue;
    facts.crmDiagnostics += crmDiagnostics;
    facts.manualDiagnostics += manualDiagnostics;
    cabinetFacts.set(cabinetKey, facts);
  }

  for (const row of rows) {
    const cabinetKey = row.external_id || row.cabinet_id || "__unknown__";
    const facts = cabinetFacts.get(cabinetKey);
    const revenue = facts?.manualRevenue && facts.manualRevenue > 0
      ? Number(row.manual_revenue) || 0
      : Number(row.crm_revenue) || 0;
    const cur = dailyAgg.get(row.date) ?? { spend: 0, leads: 0, revenue: 0 };
    cur.spend += Number(row.spend) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.revenue += revenue;
    dailyAgg.set(row.date, cur);
  }

  let cabinetSales = 0;
  let cabinetRevenue = 0;
  let cabinetDiagnostics = 0;
  let hasManualSales = false;
  let hasManualRevenue = false;
  let hasManualDiagnostics = false;
  for (const facts of cabinetFacts.values()) {
    hasManualSales ||= facts.manualSales > 0;
    hasManualRevenue ||= facts.manualRevenue > 0;
    hasManualDiagnostics ||= facts.manualDiagnostics > 0;
    cabinetSales += factValue(facts.crmSales, facts.manualSales);
    cabinetRevenue += factValue(facts.crmRevenue, facts.manualRevenue);
    cabinetDiagnostics += factValue(facts.crmDiagnostics, facts.manualDiagnostics);
  }

  return {
    spend: totSpend,
    impressions: totImp,
    clicks: totClicks,
    leads: totLeads,
    cabinetSales,
    cabinetRevenue,
    cabinetDiagnostics,
    hasManualSales,
    hasManualRevenue,
    hasManualDiagnostics,
    daily: Array.from(dailyAgg.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function aggregateCrm(leads: LeadLite[], range: ReportPeriodRange) {
  const fromTs = range.from.getTime();
  const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
  const isInRange = (value: string | null | undefined) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return t >= fromTs && t < toTs;
  };
  const inRange = leads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= fromTs && t < toTs;
  });
  // Только лиды БЕЗ cabinet_id — данные кабинетов берём из CDI, чтобы не дублировать.
  const orphan = inRange.filter((l) => !l.cabinetId);
  const orphanVisits = orphan.filter((l) => l.stageKey === "visit" || l.stageKey === "paid");
  const orphanSales = leads
    .filter((l) => !l.cabinetId && (l.paid || l.stageKey === "paid"))
    .filter((l) => (l.paidAt ? isInRange(l.paidAt) : isInRange(l.createdAt)));
  const orphanRevenue = orphanSales.reduce((s, l) => s + (l.amount || 0), 0);
  return {
    leads: inRange,
    orphanVisits,
    orphanSales,
    orphanRevenue,
  };
}

function computeTotals(
  meta: { spend: number; impressions: number; clicks: number; leads: number;
          cabinetSales: number; cabinetRevenue: number; cabinetDiagnostics: number;
          hasManualSales: boolean; hasManualRevenue: boolean; hasManualDiagnostics: boolean },
  crm: { leads: LeadLite[]; orphanVisits: LeadLite[]; orphanSales: LeadLite[]; orphanRevenue: number },
): ReportTotals {
  const totalLeads = meta.leads + crm.leads.length;
  const cpl = totalLeads > 0 ? meta.spend / totalLeads : 0;
  const visits = meta.cabinetDiagnostics + (meta.hasManualDiagnostics ? 0 : crm.orphanVisits.length);
  const sales = meta.cabinetSales + (meta.hasManualSales ? 0 : crm.orphanSales.length);
  const revenue = meta.cabinetRevenue + (meta.hasManualRevenue ? 0 : crm.orphanRevenue);
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
        const meta = await fetchMetaForRange(cabinetIds, range);
        const crm = aggregateCrm(leads, range);
        const totals = computeTotals(meta, crm);
        const scoring = computeScoring(crm.leads);
        const channels = computeChannels(crm.leads);
        const creatives: ReportCreative[] = []; // ad-level not yet exposed by edge fn

        let prev: ReportTotals | undefined;
        if (compare) {
          const prevRange = shiftRange(range);
          const prevMeta = await fetchMetaForRange(cabinetIds, prevRange);
          const prevCrm = aggregateCrm(leads, prevRange);
          prev = computeTotals(prevMeta, prevCrm);
        }

        if (cancelled) return;
        setData({ totals, prev, creatives, channels, scoring, monthlyMeta: meta.daily });
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
  }, [cabinetIds.join(","), range.from.getTime(), range.to.getTime(), compare, leads.length, tick]);

  return { data, loading, error };
}

export function deltaPct(cur: number, prev?: number): number | null {
  if (prev === undefined) return null;
  if (prev === 0) return cur === 0 ? 0 : 100;
  return ((cur - prev) / prev) * 100;
}
