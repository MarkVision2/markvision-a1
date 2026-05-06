import { useMemo } from "react";
import { useReportData, type ReportPeriodRange } from "./useReportData";
import { useLeadsLite } from "./useLeadsLite";
import { buildAlerts } from "@/lib/dashboardAlerts";
import { normalizeSource } from "@/lib/leadSource";

export type PeriodPreset = "today" | "7d" | "30d" | "month" | "custom";

export function getPresetRange(preset: PeriodPreset, custom?: ReportPeriodRange): ReportPeriodRange {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "custom" && custom) return custom;
  if (preset === "today") return { from: end, to: end };
  if (preset === "7d") {
    const f = new Date(end);
    f.setDate(f.getDate() - 6);
    return { from: f, to: end };
  }
  if (preset === "30d") {
    const f = new Date(end);
    f.setDate(f.getDate() - 29);
    return { from: f, to: end };
  }
  // month
  const f = new Date(end.getFullYear(), end.getMonth(), 1);
  return { from: f, to: end };
}

function dayKey(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export function useDashboardData(
  cabinetId: string,
  range: ReportPeriodRange,
  compare: boolean,
) {
  const { data, loading, error } = useReportData(cabinetId, range, compare);
  const { leads } = useLeadsLite();

  const alerts = useMemo(
    () => (data ? buildAlerts(data.totals, data.prev) : []),
    [data],
  );

  const fromTs = range.from.getTime();
  const toTs = useMemo(
    () => new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime(),
    [range.to],
  );

  // CRM funnel for clinic
  const crmFunnel = useMemo(() => {
    const inRange = leads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= fromTs && t < toTs;
    });
    const total = inRange.length;
    const reached = inRange.filter((l) => l.stageKey !== "new" && l.stageKey !== "no_answer").length;
    const scheduled = inRange.filter((l) => ["scheduled", "visit", "paid"].includes(l.stageKey)).length;
    const visited = inRange.filter((l) => ["visit", "paid"].includes(l.stageKey)).length;
    const paid = inRange.filter((l) => l.stageKey === "paid").length;
    return { total, reached, scheduled, visited, paid };
  }, [leads, fromTs, toTs]);

  // Channels enriched with revenue/sales — uses normalized source labels
  const channels = useMemo(() => {
    const inRange = leads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= fromTs && t < toTs;
    });
    const map = new Map<string, { name: string; leads: number; sales: number; revenue: number }>();
    for (const l of inRange) {
      const meta = normalizeSource(l.source);
      const k = meta.key === "unknown" && meta.raw ? meta.raw : meta.key;
      const cur = map.get(k) ?? { name: meta.label, leads: 0, sales: 0, revenue: 0 };
      cur.leads += 1;
      if (l.stageKey === "paid") {
        cur.sales += 1;
        cur.revenue += l.amount || 0;
      }
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.leads - a.leads);
  }, [leads, fromTs, toTs]);

  // Daily timeseries: spend (from meta) + revenue (from CRM paid leads)
  const timeseries = useMemo(() => {
    if (!data) return [];
    const spendByDay = new Map<string, number>();
    const leadsByDay = new Map<string, number>();
    const revByDay = new Map<string, number>();
    for (const d of data.monthlyMeta) {
      spendByDay.set(d.date, (spendByDay.get(d.date) ?? 0) + d.spend);
      leadsByDay.set(d.date, (leadsByDay.get(d.date) ?? 0) + d.leads);
      revByDay.set(d.date, (revByDay.get(d.date) ?? 0) + (d.revenue ?? 0));
    }
    // CRM-лиды без cabinet_id — добавляем их выручку отдельно (чтобы не задвоить CDI).
    for (const l of leads) {
      if (l.stageKey !== "paid" || l.cabinetId) continue;
      const t = new Date(l.createdAt).getTime();
      if (t < fromTs || t >= toTs) continue;
      const k = dayKey(l.createdAt);
      revByDay.set(k, (revByDay.get(k) ?? 0) + (l.amount || 0));
    }
    const out: { date: string; spend: number; revenue: number; leads: number; cpl: number }[] = [];
    const cur = new Date(range.from);
    while (cur.getTime() <= range.to.getTime()) {
      const k = dayKey(cur);
      const spend = spendByDay.get(k) ?? 0;
      const ld = leadsByDay.get(k) ?? 0;
      out.push({
        date: k,
        spend,
        revenue: revByDay.get(k) ?? 0,
        leads: ld,
        cpl: ld > 0 ? spend / ld : 0,
      });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [data, leads, fromTs, toTs, range.from, range.to]);

  return { data, loading, error, alerts, crmFunnel, channels, timeseries };
}