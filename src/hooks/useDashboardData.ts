import { useEffect, useMemo, useState } from "react";
import { useReportData, type ReportPeriodRange } from "./useReportData";
import { useLeadsLite } from "./useLeadsLite";
import { useInstagramOrganic } from "./useInstagramOrganic";
import { buildAlerts } from "@/lib/dashboardAlerts";
import { normalizeSource } from "@/lib/leadSource";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "./useProjectsStore";
import { useRealtimeTable } from "./useRealtimeTable";

function dayKey(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

type ProviderKey = "meta" | "google" | "instagram_organic";

interface ProviderAgg {
  provider: ProviderKey;
  label: string;
  spend: number;
  leads: number;
  revenue: number;
  sales: number;
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  instagram_organic: "Instagram (organic)",
};

function dayKeyInRange(date: Date, fromTs: number, toTs: number): boolean {
  const t = date.getTime();
  return t >= fromTs && t < toTs;
}

export function useDashboardData(
  cabinetId: string,
  range: ReportPeriodRange,
  compare: boolean,
) {
  const { data, loading, error } = useReportData(cabinetId, range, compare);
  const { leads } = useLeadsLite();
  const { funnel: igFunnel, events: igEvents } = useInstagramOrganic(range);
  const { activeId: projectId } = useProjectsStore();
  const [providerAgg, setProviderAgg] = useState<ProviderAgg[]>([]);
  const [pTick, setPTick] = useState(0);

  useRealtimeTable("cabinet_daily_insights", () => setPTick((t) => t + 1), true, 1000);

  const alerts = useMemo(
    () => (data ? buildAlerts(data.totals, data.prev) : []),
    [data],
  );

  const fromTs = range.from.getTime();
  const toTs = useMemo(
    () => new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime(),
    [range.to],
  );

  const sinceYmd = useMemo(() => {
    const d = range.from;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [range.from]);
  const untilYmd = useMemo(() => {
    const d = range.to;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [range.to]);

  // Multi-provider агрегат по CDI: разбиваем расход / заявки / выручку
  // по платформам (Meta vs Google), чтобы строки в таблице каналов были
  // реальными, а не разнесёнными пропорционально доле лидов.
  useEffect(() => {
    if (!projectId) {
      setProviderAgg([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data: rows, error: err } = await supabase
        .from("cabinet_daily_insights")
        .select("provider, spend, leads, crm_sales, manual_sales, crm_revenue, manual_revenue")
        .eq("project_id", projectId)
        .gte("date", sinceYmd)
        .lte("date", untilYmd);
      if (cancelled || err) {
        if (!cancelled) setProviderAgg([]);
        return;
      }
      const acc = new Map<ProviderKey, ProviderAgg>();
      for (const r of rows ?? []) {
        const provider = ((r as { provider?: string }).provider ?? "meta") as ProviderKey;
        const cur = acc.get(provider) ?? {
          provider,
          label: PROVIDER_LABELS[provider] ?? provider,
          spend: 0, leads: 0, revenue: 0, sales: 0,
        };
        cur.spend += Number((r as { spend?: number }).spend ?? 0);
        cur.leads += Number((r as { leads?: number }).leads ?? 0);
        cur.sales += Number((r as { crm_sales?: number }).crm_sales ?? 0) + Number((r as { manual_sales?: number }).manual_sales ?? 0);
        cur.revenue +=
          Number((r as { crm_revenue?: number }).crm_revenue ?? 0) +
          Number((r as { manual_revenue?: number }).manual_revenue ?? 0);
        acc.set(provider, cur);
      }
      setProviderAgg(Array.from(acc.values()));
    })();
    return () => { cancelled = true; };
  }, [projectId, sinceYmd, untilYmd, pTick]);

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

  // Каналы для дашборда. Логика:
  //   1) Берём фактические данные по платформам из cabinet_daily_insights
  //      (provider = meta|google) — это даёт реальный spend, leads, выручку.
  //   2) Добавляем Instagram organic из instagram_organic_events.
  //   3) Если в CRM есть лиды с источниками, которых нет в (1)+(2)
  //      (например прямой звонок, рекомендация) — добавляем их отдельными строками.
  const channels = useMemo(() => {
    const inRange = leads.filter((l) => dayKeyInRange(new Date(l.createdAt), fromTs, toTs));

    interface ChannelRow {
      key: string;
      name: string;
      provider: ProviderKey | "crm";
      spend: number;
      leads: number;
      sales: number;
      revenue: number;
    }
    const rows: ChannelRow[] = [];

    for (const agg of providerAgg) {
      rows.push({
        key: agg.provider,
        name: agg.label,
        provider: agg.provider,
        spend: agg.spend,
        leads: agg.leads,
        sales: agg.sales,
        revenue: agg.revenue,
      });
    }

    // Instagram organic — отдельный канал. Заявки приходят из событий lead.
    if (igFunnel.leads > 0 || igFunnel.codewordDms > 0) {
      const igRevenue = igEvents
        .filter((e) => e.eventType === "lead" && e.leadId)
        .reduce((sum, e) => {
          const lead = leads.find((l) => l.id === e.leadId);
          return sum + (lead?.stageKey === "paid" ? lead.amount || 0 : 0);
        }, 0);
      const igSales = igEvents
        .filter((e) => e.eventType === "lead" && e.leadId)
        .filter((e) => leads.find((l) => l.id === e.leadId)?.stageKey === "paid")
        .length;
      rows.push({
        key: "instagram_organic",
        name: PROVIDER_LABELS.instagram_organic,
        provider: "instagram_organic",
        spend: 0,
        leads: igFunnel.leads,
        sales: igSales,
        revenue: igRevenue,
      });
    }

    // Если ни одна платформа не выдала данных, но в CRM есть лиды
    // с маркированным источником — показываем их разбивку.
    const knownKeys = new Set(rows.map((r) => r.key));
    if (rows.length === 0 || inRange.length > 0) {
      const map = new Map<string, ChannelRow>();
      for (const l of inRange) {
        const meta = normalizeSource(l.source);
        // Лиды Meta Ads и Google Ads уже учтены через providerAgg — не дублируем.
        if (meta.key === "meta" && knownKeys.has("meta")) continue;
        if (meta.key === "google" && knownKeys.has("google")) continue;
        if ((meta.key === "instagram" || meta.key === "instagram_organic") && knownKeys.has("instagram_organic")) continue;
        const k = meta.key === "unknown" && meta.raw ? meta.raw : meta.key;
        const cur = map.get(k) ?? {
          key: k, name: meta.label, provider: "crm" as const,
          spend: 0, leads: 0, sales: 0, revenue: 0,
        };
        cur.leads += 1;
        if (l.stageKey === "paid") {
          cur.sales += 1;
          cur.revenue += l.amount || 0;
        }
        map.set(k, cur);
      }
      for (const v of map.values()) rows.push(v);
    }

    // Fallback: если у нас вообще пусто, но есть totals из ReportData — показываем одну строку Meta.
    if (rows.length === 0 && data?.totals && data.totals.totalLeads > 0) {
      rows.push({
        key: "meta",
        name: PROVIDER_LABELS.meta,
        provider: "meta",
        spend: data.totals.spend,
        leads: data.totals.totalLeads,
        sales: data.totals.sales,
        revenue: data.totals.revenue,
      });
    }

    return rows
      .filter((r) => r.leads > 0 || r.spend > 0)
      .sort((a, b) => b.leads - a.leads);
  }, [providerAgg, igFunnel, igEvents, leads, fromTs, toTs, data?.totals]);

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

  return {
    data, loading, error, alerts, crmFunnel, channels, timeseries,
    instagramFunnel: igFunnel,
    instagramEvents: igEvents,
  };
}