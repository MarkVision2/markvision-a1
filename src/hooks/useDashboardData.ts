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

  // Каналы для дашборда. ВЫСОКОУРОВНЕВЫЕ КАНАЛЫ ТРАФИКА:
  // WhatsApp · Сайт · Instagram · Google Ads · TikTok Ads.
  // Раньше показывали «Facebook Ads / Лид-формы / Прочее» — но Facebook Ads
  // это провайдер рекламы (как Google), а не точка входа лида. Реальные
  // точки входа — WhatsApp / Сайт / Instagram (organic). Meta-расход
  // раскидываем по WhatsApp и Сайт пропорционально доле лидов.
  // Google Ads / TikTok Ads — отдельные строки из providerAgg.
  const channels = useMemo(() => {
    const inRange = leads.filter((l) => dayKeyInRange(new Date(l.createdAt), fromTs, toTs));
    const paidInRange = leads.filter((l) => {
      if (!isLeadPaid(l)) return false;
      const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(paidAt).getTime();
      return t >= fromTs && t < toTs;
    });

    type BucketKey = "whatsapp" | "site" | "instagram" | "google" | "tiktok";
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
      instagram: "Instagram",
      google: "Google Ads",
      tiktok: "TikTok Ads",
    };

    const classify = (l: typeof inRange[number]): BucketKey => {
      const src = (l.source ?? "").toLowerCase();
      const ch = (l.channel ?? "").toLowerCase();
      const refr = (l.referrer ?? "").toLowerCase();
      const landing = (l.utm?.source ?? "").toLowerCase();
      if (/whatsapp|^wa$|wa\.me/.test(src) || /whatsapp|^wa$/.test(ch) || /wa\.me|whatsapp/.test(refr)) return "whatsapp";
      if (/tiktok|tt_ads|^tt$/.test(src) || /tiktok/.test(landing)) return "tiktok";
      if (/google|googleads|gads|gsearch/.test(src) || /google/.test(landing)) return "google";
      if (/instagram|^ig$|insta/.test(src) || /instagram/.test(landing) || /instagram\.com/.test(refr)) return "instagram";
      if (/site|web|landing|tilda|wordpress|^lp$/.test(src) || /site|web|form/.test(ch) || /site|web|landing|tilda|wordpress/.test(landing)) return "site";
      // Meta/Facebook без явного канала: WhatsApp если destination — WA, иначе Сайт.
      if (/meta|facebook|fb_ads|^fb$|lead.?form|leadgen|fb_form/.test(src)) {
        if (/whatsapp|wa\.me/.test(refr) || /whatsapp/.test(landing)) return "whatsapp";
        return "site";
      }
      return "site";
    };

    const buckets = new Map<BucketKey, ChannelRow>();
    const ensure = (k: BucketKey) => {
      let cur = buckets.get(k);
      if (!cur) {
        cur = { key: k, name: BUCKET_LABELS[k], provider: k, spend: 0, leads: 0, sales: 0, revenue: 0 };
        buckets.set(k, cur);
      }
      return cur;
    };
    // Заглушки, чтобы все 5 каналов всегда отображались в одном и том же порядке
    for (const k of ["whatsapp", "site", "instagram", "google", "tiktok"] as BucketKey[]) ensure(k);

    // 1) Лиды по createdAt
    for (const l of inRange) ensure(classify(l)).leads += 1;
    // 2) Продажи по paid_at
    for (const l of paidInRange) {
      const b = ensure(classify(l));
      b.sales += 1;
      b.revenue += l.amount || 0;
    }

    // 3) Instagram organic — отдельные события (если есть)
    if (igFunnel.leads > 0 || igFunnel.codewordDms > 0) {
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
      const ig = ensure("instagram");
      ig.leads += igFunnel.leads;
      ig.sales += igPaidLeads.length;
      ig.revenue += igPaidLeads.reduce((s, l) => s + (l.amount || 0), 0);
    }

    // 4) Расход CDI: Meta распределяем между WhatsApp и Сайт пропорционально
    //    доле лидов; Google → bucket "google" целиком; TikTok → "tiktok" целиком.
    const metaSpend = providerAgg
      .filter((a) => a.provider !== "google" && a.provider !== "instagram_organic")
      .reduce((s, a) => s + a.spend, 0);
    const googleSpend = providerAgg.filter((a) => a.provider === "google").reduce((s, a) => s + a.spend, 0);

    const metaBucketKeys: BucketKey[] = ["whatsapp", "site"];
    const metaLeadsTotal = metaBucketKeys.reduce((s, k) => s + (buckets.get(k)?.leads ?? 0), 0);
    if (metaSpend > 0 && metaLeadsTotal > 0) {
      for (const k of metaBucketKeys) {
        const b = buckets.get(k);
        if (b) b.spend = (b.leads / metaLeadsTotal) * metaSpend;
      }
    }
    if (googleSpend > 0) ensure("google").spend += googleSpend;

    // Возвращаем все 5 в фиксированном порядке (даже если в каких-то 0)
    return ["whatsapp", "site", "instagram", "google", "tiktok"]
      .map((k) => buckets.get(k as BucketKey)!)
      .filter(Boolean);
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