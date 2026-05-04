import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";
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

async function fetchMetaForRange(
  cabinetIds: string[],
  range: ReportPeriodRange,
): Promise<{ spend: number; impressions: number; clicks: number; leads: number; daily: { date: string; spend: number; leads: number }[] }> {
  // edge function provides per-month aggregation. We fetch each month between from..to
  // and then filter daily rows inside the range.
  if (cabinetIds.length === 0) {
    return { spend: 0, impressions: 0, clicks: 0, leads: 0, daily: [] };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    return { spend: 0, impressions: 0, clicks: 0, leads: 0, daily: [] };
  }
  const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

  // unique months in the range
  const months = new Set<string>();
  const cur = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  const endMonth = new Date(range.to.getFullYear(), range.to.getMonth(), 1);
  while (cur <= endMonth) {
    months.add(isoMonth(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  const fromTs = range.from.getTime();
  const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();

  const dailyAgg = new Map<string, { spend: number; leads: number }>();
  let totSpend = 0, totImp = 0, totClicks = 0, totLeads = 0;

  for (const actId of cabinetIds) {
    for (const month of months) {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-insights?actId=${encodeURIComponent(actId)}&month=${encodeURIComponent(month)}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, apikey },
        });
        if (!resp.ok) continue;
        const json = await resp.json();
        const daily: Array<{ date: string; spend: number; impressions: number; clicks: number; leads: number }> = json.daily ?? [];
        for (const d of daily) {
          const t = new Date(d.date).getTime();
          if (t < fromTs || t >= toTs) continue;
          totSpend += d.spend;
          totImp += d.impressions;
          totClicks += d.clicks;
          totLeads += d.leads;
          const cur = dailyAgg.get(d.date) ?? { spend: 0, leads: 0 };
          cur.spend += d.spend;
          cur.leads += d.leads;
          dailyAgg.set(d.date, cur);
        }
      } catch {
        /* noop */
      }
    }
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
  const { cabinets } = useCabinetsStore();
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