import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { useLeadsLite, type LeadLite } from "@/hooks/useLeadsLite";
import { normalizeSource } from "@/lib/leadSource";

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
  monthlyMeta: { date: string; spend: number; leads: number }[];
}

const EMPTY_TOTALS: ReportTotals = {
  spend: 0, impressions: 0, clicks: 0, adsLeads: 0, crmLeads: 0,
  totalLeads: 0, visits: 0, sales: 0, revenue: 0,
  cpl: 0, cpv: 0, cac: 0, ctr: 0, romi: 0, aov: 0,
};

function isoMonth(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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
): Promise<{ spend: number; impressions: number; clicks: number; leads: number; daily: { date: string; spend: number; leads: number }[] }> {
  if (externalIds.length === 0) {
    return { spend: 0, impressions: 0, clicks: 0, leads: 0, daily: [] };
  }
  const ids = externalIds.map(normalizeActId);
  const since = ymd(range.from);
  const until = ymd(range.to);

  const { data, error } = await supabase
    .from("cabinet_daily_insights")
    .select("date, spend, impressions, clicks, leads")
    .in("external_id", ids)
    .gte("date", since)
    .lte("date", until);
  if (error) throw new Error(error.message);

  const dailyAgg = new Map<string, { spend: number; leads: number }>();
  let totSpend = 0, totImp = 0, totClicks = 0, totLeads = 0;

  for (const row of data ?? []) {
    const spend = Number(row.spend) || 0;
    const impressions = Number(row.impressions) || 0;
    const clicks = Number(row.clicks) || 0;
    const leads = Number(row.leads) || 0;
    totSpend += spend;
    totImp += impressions;
    totClicks += clicks;
    totLeads += leads;
    const cur = dailyAgg.get(row.date) ?? { spend: 0, leads: 0 };
    cur.spend += spend;
    cur.leads += leads;
    dailyAgg.set(row.date, cur);
  }

  return {
    spend: totSpend,
    impressions: totImp,
    clicks: totClicks,
    leads: totLeads,
    daily: Array.from(dailyAgg.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function aggregateCrm(leads: LeadLite[], range: ReportPeriodRange) {
  const fromTs = range.from.getTime();
  const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
  const inRange = leads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= fromTs && t < toTs;
  });
  const visits = inRange.filter((l) => l.stageKey === "visit" || l.stageKey === "paid");
  const sales = inRange.filter((l) => l.stageKey === "paid");
  const revenue = sales.reduce((s, l) => s + (l.amount || 0), 0);
  return { leads: inRange, visits, sales, revenue };
}

function computeTotals(
  meta: { spend: number; impressions: number; clicks: number; leads: number },
  crm: { leads: LeadLite[]; visits: LeadLite[]; sales: LeadLite[]; revenue: number },
): ReportTotals {
  const totalLeads = meta.leads + crm.leads.length;
  const cpl = totalLeads > 0 ? meta.spend / totalLeads : 0;
  const cpv = crm.visits.length > 0 ? meta.spend / crm.visits.length : 0;
  const cac = crm.sales.length > 0 ? meta.spend / crm.sales.length : 0;
  const ctr = meta.impressions > 0 ? (meta.clicks / meta.impressions) * 100 : 0;
  const romi = meta.spend > 0 ? ((crm.revenue - meta.spend) / meta.spend) * 100 : crm.revenue > 0 ? 100 : 0;
  const aov = crm.sales.length > 0 ? crm.revenue / crm.sales.length : 0;
  return {
    spend: meta.spend,
    impressions: meta.impressions,
    clicks: meta.clicks,
    adsLeads: meta.leads,
    crmLeads: crm.leads.length,
    totalLeads,
    visits: crm.visits.length,
    sales: crm.sales.length,
    revenue: crm.revenue,
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
  }, [cabinetIds.join(","), range.from.getTime(), range.to.getTime(), compare, leads.length]);

  return { data, loading, error };
}

export function deltaPct(cur: number, prev?: number): number | null {
  if (prev === undefined) return null;
  if (prev === 0) return cur === 0 ? 0 : 100;
  return ((cur - prev) / prev) * 100;
}