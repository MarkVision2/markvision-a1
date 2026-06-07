import { useEffect, useMemo, useState } from "react";
import { useReportData, type ReportPeriodRange } from "./useReportData";
import { useLeadsLite } from "./useLeadsLite";
import { useInstagramOrganic } from "./useInstagramOrganic";
import { buildAlerts } from "@/lib/dashboardAlerts";
import { buildDashboardChannels } from "@/lib/dashboardChannels";
import { isLeadPaid, isLeadVisit } from "@/lib/leadStageFlags";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "./useProjectsStore";
import { useRealtimeTable } from "./useRealtimeTable";

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
        // Override-семантика: ручные значения перезаписывают CRM (NULL = «не задано»).
        const crmS = Number((r as { crm_sales?: number }).crm_sales ?? 0);
        const manS = (r as { manual_sales?: number | null }).manual_sales;
        cur.sales += manS !== null && manS !== undefined ? Number(manS) || 0 : crmS;
        const crmR = Number((r as { crm_revenue?: number }).crm_revenue ?? 0);
        const manR = (r as { manual_revenue?: number | null }).manual_revenue;
        cur.revenue += manR !== null && manR !== undefined ? Number(manR) || 0 : crmR;
        acc.set(provider, cur);
      }
      setProviderAgg(Array.from(acc.values()));
    })();
    return () => { cancelled = true; };
  }, [projectId, sinceYmd, untilYmd, pTick]);

  // CRM funnel: total/reached считаем по createdAt (когда лид пришёл).
  // scheduled/visited/paid — по дате СОБЫТИЯ (paid_at / last_activity_at), как
  // и в верхних KPI. Раньше scheduled фильтровался по createdAt + `isLeadVisit`,
  // из-за чего лид, оплаченный в мае, но созданный в апреле, в мае давал
  // visited=1/paid=1 при scheduled=0 (нарушение монотонности воронки) и наоборот.
  const crmFunnel = useMemo(() => {
    const inRange = leads.filter((l) => {
      const t = new Date(l.createdAt).getTime();
      return t >= fromTs && t < toTs;
    });
    const paidInRange = leads.filter((l) => {
      if (!isLeadPaid(l)) return false;
      const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(paidAt).getTime();
      return t >= fromTs && t < toTs;
    });
    const visitedInRange = leads.filter((l) => {
      if (!isLeadVisit(l)) return false;
      const refDate = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(refDate).getTime();
      return t >= fromTs && t < toTs;
    });
    // "Записались": лид достиг хотя бы scheduled-стадии. По дате последней активности
    // (или paid_at, если уже оплачен) — чтобы цифра не падала ниже visited/paid.
    const scheduledInRange = leads.filter((l) => {
      const isScheduled =
        (l.stageKey ?? "").toLowerCase() === "scheduled" || isLeadVisit(l);
      if (!isScheduled) return false;
      const refDate = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(refDate).getTime();
      return t >= fromTs && t < toTs;
    });
    const total = inRange.length;
    const reached = inRange.filter((l) => l.stageKey !== "new" && l.stageKey !== "no_answer").length;
    const scheduled = scheduledInRange.length;
    const visited = visitedInRange.length;
    const paid = paidInRange.length;
    return { total, reached, scheduled, visited, paid };
  }, [leads, fromTs, toTs]);

  const channels = useMemo(() => {
    const igPaidLeads = igEvents
      .filter((e) => e.eventType === "lead" && e.leadId)
      .map((e) => leads.find((l) => l.id === e.leadId))
      .filter((l): l is typeof leads[number] => {
        if (!l || l.cabinetId) return false;
        if (!isLeadPaid(l)) return false;
        const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
        const t = new Date(paidAt).getTime();
        return t >= fromTs && t < toTs;
      });

    return buildDashboardChannels({
      leads,
      totals: data?.totals,
      providerAgg,
      fromTs,
      toTs,
      igOrganicLeads: igFunnel.leads,
      igOrganicSales: igPaidLeads.length,
      igOrganicRevenue: igPaidLeads.reduce((s, l) => s + (l.amount || 0), 0),
    });
  }, [providerAgg, igFunnel, igEvents, leads, fromTs, toTs, data?.totals]);



  // Daily timeseries: spend/leads из CDI, выручка — из Таблицы показателей (crmDailyMetrics + manual).
  const timeseries = useMemo(() => {
    if (!data) return [];
    return data.monthlyMeta.map((d) => ({
      date: d.date,
      spend: d.spend,
      revenue: d.revenue ?? 0,
      leads: d.leads,
      cpl: d.leads > 0 ? d.spend / d.leads : 0,
    }));
  }, [data]);

  return {
    data, loading, error, alerts, crmFunnel, channels, timeseries,
    instagramFunnel: igFunnel,
    instagramEvents: igEvents,
  };
}