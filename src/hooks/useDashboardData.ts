import { useEffect, useMemo, useState } from "react";
import { useReportData, type ReportPeriodRange } from "./useReportData";
import { useLeadsLite } from "./useLeadsLite";
import { useInstagramOrganic } from "./useInstagramOrganic";
import { buildAlerts } from "@/lib/dashboardAlerts";
import { normalizeSource } from "@/lib/leadSource";
import { isLeadPaid, isLeadVisit } from "@/lib/leadStageFlags";
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
        // Override-семантика: ручные значения перезаписывают CRM, не суммируются.
        const crmS = Number((r as { crm_sales?: number }).crm_sales ?? 0);
        const manS = Number((r as { manual_sales?: number }).manual_sales ?? 0);
        cur.sales += manS > 0 ? manS : crmS;
        const crmR = Number((r as { crm_revenue?: number }).crm_revenue ?? 0);
        const manR = Number((r as { manual_revenue?: number }).manual_revenue ?? 0);
        cur.revenue += manR > 0 ? manR : crmR;
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
    // Используем helpers вместо хардкода ключей стадий: isLeadVisit ловит и "visit"/"diagnosed",
    // и paid (он сам внутри проверяет isLeadPaid). Так что:
    //   scheduled — все, кто либо записан, либо был на визите, либо оплатил
    //   visited   — те, кто на визите или оплатил
    const scheduled = inRange.filter((l) => l.stageKey === "scheduled" || isLeadVisit(l)).length;
    const visited = inRange.filter(isLeadVisit).length;
    const paid = inRange.filter(isLeadPaid).length;
    return { total, reached, scheduled, visited, paid };
  }, [leads, fromTs, toTs]);

  // Каналы для дашборда. Группируем по ТОЧКЕ ВХОДА заявки (куда пришёл лид),
  // а не по провайдеру рекламы — потому что Meta Ads, Facebook и Instagram
  // ведут трафик в одни и те же 3 источника: WhatsApp, Сайт, Лид-формы.
  // Иначе одни и те же заявки считаются дважды (CDI Meta + CRM whatsapp).
  // Расход Meta+Google распределяется между бакетами по доле заявок.
  const channels = useMemo(() => {
    const inRange = leads.filter((l) => dayKeyInRange(new Date(l.createdAt), fromTs, toTs));

    type BucketKey = "whatsapp" | "site" | "lead_form" | "instagram_organic" | "other";
    interface ChannelRow {
      key: string;
      name: string;
      provider: BucketKey;
      spend: number;
      leads: number;
      sales: number;
      revenue: number;
    }

    const BUCKET_LABELS: Record<BucketKey, string> = {
      whatsapp: "WhatsApp",
      site: "Сайт",
      lead_form: "Лид-формы",
      instagram_organic: "Instagram organic",
      other: "Прочее",
    };

    const classify = (l: typeof inRange[number]): BucketKey => {
      const src = (l.source ?? "").toLowerCase();
      const ch = (l.channel ?? "").toLowerCase();
      const refr = (l.referrer ?? "").toLowerCase();
      // Lead-форма Meta — обычно source/channel = lead_form / leadgen / fb_form
      if (/lead.?form|leadgen|fb_form|fb-form/.test(src) || /lead.?form|leadgen/.test(ch)) return "lead_form";
      if (/whatsapp|^wa$|wa\.me/.test(src) || /whatsapp|^wa$/.test(ch) || /wa\.me|whatsapp/.test(refr)) return "whatsapp";
      if (/site|web|landing|^lp$|tilda|wordpress/.test(src) || /site|web|form/.test(ch)) return "site";
      return "other";
    };

    const buckets = new Map<BucketKey, ChannelRow>();
    for (const l of inRange) {
      const k = classify(l);
      const cur = buckets.get(k) ?? {
        key: k, name: BUCKET_LABELS[k], provider: k,
        spend: 0, leads: 0, sales: 0, revenue: 0,
      };
      cur.leads += 1;
      if (isLeadPaid(l)) {
        cur.sales += 1;
        cur.revenue += l.amount || 0;
      }
      buckets.set(k, cur);
    }

    // Instagram organic — отдельный канал, считаем только лиды без cabinet_id,
    // чтобы не задвоить с реклaмными.
    if (igFunnel.leads > 0 || igFunnel.codewordDms > 0) {
      const igRevenue = igEvents
        .filter((e) => e.eventType === "lead" && e.leadId)
        .reduce((sum, e) => {
          const lead = leads.find((l) => l.id === e.leadId);
          if (!lead || lead.cabinetId) return sum;
          return sum + (isLeadPaid(lead) ? lead.amount || 0 : 0);
        }, 0);
      const igSales = igEvents
        .filter((e) => e.eventType === "lead" && e.leadId)
        .filter((e) => {
          const lead = leads.find((l) => l.id === e.leadId);
          return lead && !lead.cabinetId && isLeadPaid(lead);
        }).length;
      buckets.set("instagram_organic", {
        key: "instagram_organic",
        name: BUCKET_LABELS.instagram_organic,
        provider: "instagram_organic",
        spend: 0,
        leads: igFunnel.leads,
        sales: igSales,
        revenue: igRevenue,
      });
    }

    // Расход всех платных каналов (Meta + Google) из CDI — распределяем
    // пропорционально доле заявок по платным бакетам (WA / Site / LeadForm).
    const paidSpend = providerAgg
      .filter((a) => a.provider !== "instagram_organic")
      .reduce((s, a) => s + a.spend, 0);

    const paidBucketKeys: BucketKey[] = ["whatsapp", "site", "lead_form"];
    const paidLeadsTotal = paidBucketKeys.reduce(
      (s, k) => s + (buckets.get(k)?.leads ?? 0), 0,
    );

    if (paidSpend > 0 && paidLeadsTotal > 0) {
      for (const k of paidBucketKeys) {
        const b = buckets.get(k);
        if (!b) continue;
        b.spend = (b.leads / paidLeadsTotal) * paidSpend;
      }
    }

    const rows = Array.from(buckets.values());
    return rows
      .filter((r) => r.leads > 0 || r.spend > 0)
      .sort((a, b) => b.leads - a.leads);
  }, [providerAgg, igFunnel, igEvents, leads, fromTs, toTs]);



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
    // isLeadPaid вместо хардкода "paid" — иначе график занижался при custom-стадиях
    // и расходился с totals.revenue в верхних KPI Dashboard.
    // Группируем по дню ОПЛАТЫ (paidAt), а не по созданию лида — иначе выручка ложится
    // не на тот день, в который реально пришли деньги.
    for (const l of leads) {
      if (!isLeadPaid(l) || l.cabinetId) continue;
      const dateForBucket = l.paidAt ?? l.createdAt;
      const t = new Date(dateForBucket).getTime();
      if (t < fromTs || t >= toTs) continue;
      const k = dayKey(dateForBucket);
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