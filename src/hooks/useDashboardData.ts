import { useEffect, useMemo, useState } from "react";
import { useReportData, type ReportPeriodRange } from "./useReportData";
import { useLeadsLite } from "./useLeadsLite";
import { useInstagramOrganic } from "./useInstagramOrganic";
import { buildAlerts } from "@/lib/dashboardAlerts";
import type { DashboardChannel, DashboardChannelProvider } from "@/lib/dashboardChannels";
import { normalizeSource } from "@/lib/leadSource";
import { factValue } from "@/lib/insightFacts";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "./useProjectsStore";
import { useRealtimeTable } from "./useRealtimeTable";

export type PeriodPreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "week"
  | "month"
  | "prevMonth"
  | "custom";

export function getPresetRange(preset: PeriodPreset, custom?: ReportPeriodRange): ReportPeriodRange {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "custom" && custom) return custom;
  if (preset === "today") return { from: end, to: end };
  if (preset === "yesterday") {
    const y = new Date(end);
    y.setDate(y.getDate() - 1);
    return { from: y, to: y };
  }
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
  if (preset === "week") {
    // Эта неделя — с понедельника по сегодня
    const dow = (end.getDay() + 6) % 7; // Mon=0 ... Sun=6
    const f = new Date(end);
    f.setDate(f.getDate() - dow);
    return { from: f, to: end };
  }
  if (preset === "prevMonth") {
    const f = new Date(end.getFullYear(), end.getMonth() - 1, 1);
    const t = new Date(end.getFullYear(), end.getMonth(), 0);
    return { from: f, to: t };
  }
  // month — этот месяц
  const f = new Date(end.getFullYear(), end.getMonth(), 1);
  return { from: f, to: end };
}

function dayKey(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

type ProviderKey = DashboardChannelProvider;

interface ProviderAgg {
  provider: ProviderKey;
  label: string;
  spend: number;
  leads: number;
  revenue: number;
  sales: number;
}

interface ProviderFactBucket {
  provider: ProviderKey;
  label: string;
  spend: number;
  leads: number;
  crmSales: number;
  manualSales: number;
  crmRevenue: number;
  manualRevenue: number;
}

function dashboardSourceForLead(lead: {
  source?: string | null;
  channel?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
}): Pick<DashboardChannel, "key" | "name" | "provider"> {
  const source = (lead.source ?? "").trim().toLowerCase();
  const channel = (lead.channel ?? "").trim().toLowerCase();
  const utm = lead.utm ?? {};
  const utmSource = (utm.source ?? "").trim().toLowerCase();
  const utmMedium = (utm.medium ?? "").trim().toLowerCase();
  const utmCampaign = (utm.campaign ?? "").trim().toLowerCase();
  const all = [source, channel, utmSource, utmMedium, utmCampaign].filter(Boolean).join(" ");

  if (channel === "whatsapp" || /\b(wa|whatsapp)\b/.test(all)) {
    return { key: "whatsapp", name: "WhatsApp", provider: "whatsapp" };
  }
  if (channel === "web" || ["site", "web", "website", "tilda"].includes(source)) {
    return { key: "site", name: "Сайт", provider: "site" };
  }
  if (/\b(lead_form|leadform|instant_form|form)\b/.test(all)) {
    return { key: "lead_form", name: "Лид-форма Meta", provider: "lead_form" };
  }
  if (/\b(messenger|direct)\b/.test(all)) {
    return { key: "messages", name: "Direct / Messenger", provider: "messages" };
  }
  if (/\b(google|googleads|adwords|gads)\b/.test(all)) {
    return { key: "google", name: PROVIDER_LABELS.google, provider: "google" };
  }
  if (/\b(meta|facebook|fb|instagram|insta|ig)\b/.test(all)) {
    return { key: "meta", name: PROVIDER_LABELS.meta, provider: "meta" };
  }

  const meta = normalizeSource(lead.source);
  const key = meta.key === "unknown" && meta.raw ? meta.raw : meta.key;
  return {
    key,
    name: meta.label,
    provider: meta.key === "google" ? "google" : "crm",
  };
}

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  instagram_organic: "Instagram (organic)",
  crm: "CRM / прочее",
  site: "Сайт",
  whatsapp: "WhatsApp",
  lead_form: "Лид-форма Meta",
  messages: "Direct / Messenger",
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
      const acc = new Map<ProviderKey, ProviderFactBucket>();
      for (const r of rows ?? []) {
        const provider = ((r as { provider?: string }).provider ?? "meta") as ProviderKey;
        const cur = acc.get(provider) ?? {
          provider,
          label: PROVIDER_LABELS[provider] ?? provider,
          spend: 0, leads: 0,
          crmSales: 0, manualSales: 0,
          crmRevenue: 0, manualRevenue: 0,
        };
        cur.spend += Number((r as { spend?: number }).spend ?? 0);
        cur.leads += Number((r as { leads?: number }).leads ?? 0);
        cur.crmSales += Number((r as { crm_sales?: number }).crm_sales ?? 0);
        cur.manualSales += Number((r as { manual_sales?: number }).manual_sales ?? 0);
        cur.crmRevenue += Number((r as { crm_revenue?: number }).crm_revenue ?? 0);
        cur.manualRevenue += Number((r as { manual_revenue?: number }).manual_revenue ?? 0);
        acc.set(provider, cur);
      }
      setProviderAgg(Array.from(acc.values()).map((bucket) => ({
        provider: bucket.provider,
        label: bucket.label,
        spend: bucket.spend,
        leads: bucket.leads,
        sales: factValue(bucket.crmSales, bucket.manualSales),
        revenue: factValue(bucket.crmRevenue, bucket.manualRevenue),
      })));
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
    const scheduled = inRange.filter((l) => l.stageIsDiagnostic || ["scheduled", "visit", "invoice", "paid"].includes(l.stageKey) || l.paid).length;
    const visited = inRange.filter((l) => ["visit", "paid"].includes(l.stageKey) || l.paid).length;
    const paid = inRange.filter((l) => l.paid || l.stageKey === "paid").length;
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

    const map = new Map<string, DashboardChannel>();
    const ensure = (lead: typeof leads[number]) => {
      const meta = dashboardSourceForLead(lead);
      const cur = map.get(meta.key) ?? {
        key: meta.key,
        name: meta.name,
        provider: meta.provider,
        spend: 0,
        leads: 0,
        sales: 0,
        revenue: 0,
      };
      map.set(meta.key, cur);
      return cur;
    };

    for (const lead of inRange) {
      ensure(lead).leads += 1;
    }

    for (const lead of leads) {
      if (!lead.paid && lead.stageKey !== "paid") continue;
      const paidAt = lead.paidAt ? new Date(lead.paidAt).getTime() : new Date(lead.createdAt).getTime();
      if (paidAt < fromTs || paidAt >= toTs) continue;
      const cur = ensure(lead);
      cur.sales += 1;
      cur.revenue += lead.amount || 0;
    }

    for (const agg of providerAgg) {
      const cur = map.get(agg.provider) ?? {
        key: agg.provider,
        name: agg.label,
        provider: agg.provider,
        spend: 0,
        leads: 0,
        sales: 0,
        revenue: 0,
      };
      cur.spend += agg.spend;
      if (cur.leads === 0) cur.leads = agg.leads;
      if (cur.sales === 0) cur.sales = agg.sales;
      if (cur.revenue === 0) cur.revenue = agg.revenue;
      map.set(cur.key, cur);
    }

    const rows: DashboardChannel[] = Array.from(map.values());

    // Instagram organic — отдельный канал. Заявки приходят из событий lead.
    if (igFunnel.leads > 0 || igFunnel.codewordDms > 0) {
      const igRevenue = igEvents
        .filter((e) => e.eventType === "lead" && e.leadId)
        .reduce((sum, e) => {
          const lead = leads.find((l) => l.id === e.leadId);
          return sum + (lead?.paid || lead?.stageKey === "paid" ? lead.amount || 0 : 0);
        }, 0);
      const igSales = igEvents
        .filter((e) => e.eventType === "lead" && e.leadId)
        .filter((e) => {
          const lead = leads.find((l) => l.id === e.leadId);
          return lead?.paid || lead?.stageKey === "paid";
        })
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
