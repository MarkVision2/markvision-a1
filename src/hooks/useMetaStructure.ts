import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "./useProjectsStore";
import { useRealtimeTable } from "./useRealtimeTable";

interface Range { from: Date; to: Date }

export interface MetaCreativeRow {
  id: string;
  adId: string;
  campaignId: string | null;
  cabinetId: string | null;
  name: string;
  creativeType: "image" | "video" | "carousel" | "dynamic" | string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  videoId: string | null;
  primaryText: string | null;
  headline: string | null;
  cta: string | null;
  destinationUrl: string | null;
  effectiveStatus: string | null;
  /** Метрики Meta за выбранный период. */
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  purchases: number;
  revenue: number;
  ctr: number;
  cpl: number;
  cpc: number;
  cpm: number;
  romi: number;
  /** Сквозные CRM-метрики за выбранный период. */
  crmLeads: number;
  crmQualified: number;
  crmSales: number;
  crmRevenue: number;
  /** Расчётные сквозные показатели. */
  crmCpl: number;
  crmCps: number;
  crmAvgCheck: number;
  crmRomi: number;
  crmProfit: number;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface RawCreative {
  id: string;
  ad_id: string;
  campaign_id: string | null;
  cabinet_id: string | null;
  name: string | null;
  creative_type: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  poster_url: string | null;
  video_url: string | null;
  video_id: string | null;
  primary_text: string | null;
  headline: string | null;
  cta: string | null;
  destination_url: string | null;
  effective_status: string | null;
}

interface RawDailyAgg {
  ad_id: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  leads: number | string;
  messages: number | string;
  purchases: number | string;
  revenue: number | string;
}

export function useMetaCreatives(range: Range) {
  const { activeId: projectId } = useProjectsStore();
  const [rows, setRows] = useState<MetaCreativeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useRealtimeTable("meta_creative_daily", () => setTick((t) => t + 1), true, 2000);
  useRealtimeTable("meta_creatives", () => setTick((t) => t + 1), true, 1000);

  const since = useMemo(() => ymd(range.from), [range.from]);
  const until = useMemo(() => ymd(range.to), [range.to]);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [creativesRes, dailyRes, crmRes] = await Promise.all([
        supabase
          .from("meta_creatives")
          .select("id, ad_id, campaign_id, cabinet_id, name, creative_type, thumbnail_url, image_url, poster_url, video_url, video_id, primary_text, headline, cta, destination_url, effective_status")
          .eq("project_id", projectId)
          .limit(500),
        supabase
          .from("meta_creative_daily")
          .select("ad_id, spend, impressions, clicks, leads, messages, purchases, revenue")
          .eq("project_id", projectId)
          .gte("date", since)
          .lte("date", until),
        // Сквозные CRM-метрики из view (нет в сгенерированных типах — используем any-каст)
        (supabase as unknown as { from: (t: string) => any })
          .from("meta_creative_crm_daily")
          .select("ad_id, crm_leads, crm_qualified, crm_sales, crm_revenue")
          .eq("project_id", projectId)
          .gte("date", since)
          .lte("date", until),
      ]);
      if (cancelled) return;

      const creatives = (creativesRes.data ?? []) as RawCreative[];
      const daily = (dailyRes.data ?? []) as RawDailyAgg[];
      const crm = (crmRes.data ?? []) as Array<{ ad_id: string; crm_leads: number | string; crm_qualified: number | string; crm_sales: number | string; crm_revenue: number | string }>;
      const agg = new Map<string, {
        spend: number; impressions: number; clicks: number;
        leads: number; messages: number; purchases: number; revenue: number;
      }>();
      for (const d of daily) {
        const cur = agg.get(d.ad_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0 };
        cur.spend += Number(d.spend) || 0;
        cur.impressions += Number(d.impressions) || 0;
        cur.clicks += Number(d.clicks) || 0;
        cur.leads += Number(d.leads) || 0;
        cur.messages += Number(d.messages) || 0;
        cur.purchases += Number(d.purchases) || 0;
        cur.revenue += Number(d.revenue) || 0;
        agg.set(d.ad_id, cur);
      }
      const crmAgg = new Map<string, { crmLeads: number; crmQualified: number; crmSales: number; crmRevenue: number }>();
      for (const c of crm) {
        const cur = crmAgg.get(c.ad_id) ?? { crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 };
        cur.crmLeads += Number(c.crm_leads) || 0;
        cur.crmQualified += Number(c.crm_qualified) || 0;
        cur.crmSales += Number(c.crm_sales) || 0;
        cur.crmRevenue += Number(c.crm_revenue) || 0;
        crmAgg.set(c.ad_id, cur);
      }

      const out: MetaCreativeRow[] = creatives.map((c) => {
        const a = agg.get(c.ad_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0 };
        const cr = crmAgg.get(c.ad_id) ?? { crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 };
        const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
        const cpl = a.leads > 0 ? a.spend / a.leads : 0;
        const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
        const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
        const romi = a.spend > 0 ? ((a.revenue - a.spend) / a.spend) * 100 : 0;
        const crmCpl = cr.crmLeads > 0 ? a.spend / cr.crmLeads : 0;
        const crmCps = cr.crmSales > 0 ? a.spend / cr.crmSales : 0;
        const crmAvgCheck = cr.crmSales > 0 ? cr.crmRevenue / cr.crmSales : 0;
        const crmRomi = a.spend > 0 ? ((cr.crmRevenue - a.spend) / a.spend) * 100 : 0;
        const crmProfit = cr.crmRevenue - a.spend;
        return {
          id: c.id,
          adId: c.ad_id,
          campaignId: c.campaign_id,
          cabinetId: c.cabinet_id,
          name: c.name ?? "",
          creativeType: (c.creative_type ?? "image") as MetaCreativeRow["creativeType"],
          thumbnailUrl: c.thumbnail_url,
          imageUrl: c.image_url,
          posterUrl: c.poster_url,
          videoUrl: c.video_url,
          videoId: c.video_id,
          primaryText: c.primary_text,
          headline: c.headline,
          cta: c.cta,
          destinationUrl: c.destination_url,
          effectiveStatus: c.effective_status,
          ...a,
          ctr, cpl, cpc, cpm, romi,
          ...cr,
          crmCpl, crmCps, crmAvgCheck, crmRomi, crmProfit,
        };
      });
      out.sort((a, b) => b.spend - a.spend);
      setRows(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, since, until, tick]);

  return { rows, loading };
}

// ---------------- Campaigns ----------------

export interface MetaCampaignRow {
  id: string;
  campaignId: string;
  cabinetId: string | null;
  name: string;
  objective: string | null;
  destinationType: string | null;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  purchases: number;
  revenue: number;
  ctr: number;
  cpl: number;
  romi: number;
  /** Сквозные CRM-метрики, посчитанные по объявлениям этой кампании. */
  crmLeads: number;
  crmQualified: number;
  crmSales: number;
  crmRevenue: number;
  crmRomi: number;
  crmProfit: number;
  crmAvgCheck: number;
  crmCps: number;
}

interface RawCampaign {
  id: string;
  campaign_id: string;
  cabinet_id: string | null;
  name: string | null;
  objective: string | null;
  destination_type: string | null;
  effective_status: string | null;
  daily_budget: number | string | null;
}

interface RawCampaignDaily {
  campaign_id: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  leads: number | string;
  messages: number | string;
  purchases: number | string;
  revenue: number | string;
}

export function useMetaCampaigns(range: Range) {
  const { activeId: projectId } = useProjectsStore();
  const [rows, setRows] = useState<MetaCampaignRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useRealtimeTable("meta_campaigns", () => setTick((t) => t + 1), true, 1000);
  useRealtimeTable("meta_campaign_daily", () => setTick((t) => t + 1), true, 2000);

  const since = useMemo(() => ymd(range.from), [range.from]);
  const until = useMemo(() => ymd(range.to), [range.to]);

  useEffect(() => {
    if (!projectId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [campsRes, dailyRes, creativesRes, crmRes] = await Promise.all([
        supabase
          .from("meta_campaigns")
          .select("id, campaign_id, cabinet_id, name, objective, destination_type, effective_status, daily_budget")
          .eq("project_id", projectId)
          .limit(500),
        supabase
          .from("meta_campaign_daily")
          .select("campaign_id, spend, impressions, clicks, leads, messages, purchases, revenue")
          .eq("project_id", projectId)
          .gte("date", since)
          .lte("date", until),
        // Маппинг ad_id → campaign_id, чтобы агрегировать CRM на уровень кампании.
        supabase
          .from("meta_creatives")
          .select("ad_id, campaign_id")
          .eq("project_id", projectId)
          .limit(2000),
        // Сквозные CRM-метрики по объявлениям (view ещё нет в сгенерированных типах).
        (supabase as unknown as { from: (t: string) => any })
          .from("meta_creative_crm_daily")
          .select("ad_id, crm_leads, crm_qualified, crm_sales, crm_revenue")
          .eq("project_id", projectId)
          .gte("date", since)
          .lte("date", until),
      ]);
      if (cancelled) return;

      const camps = (campsRes.data ?? []) as RawCampaign[];
      const daily = (dailyRes.data ?? []) as RawCampaignDaily[];
      const creativeMap = new Map<string, string>(); // ad_id → campaign_id
      for (const c of (creativesRes.data ?? []) as Array<{ ad_id: string; campaign_id: string | null }>) {
        if (c.campaign_id) creativeMap.set(c.ad_id, c.campaign_id);
      }
      const crmAgg = new Map<string, { crmLeads: number; crmQualified: number; crmSales: number; crmRevenue: number }>();
      for (const c of (crmRes.data ?? []) as Array<{ ad_id: string; crm_leads: number | string; crm_qualified: number | string; crm_sales: number | string; crm_revenue: number | string }>) {
        const campaignId = creativeMap.get(c.ad_id);
        if (!campaignId) continue;
        const cur = crmAgg.get(campaignId) ?? { crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 };
        cur.crmLeads += Number(c.crm_leads) || 0;
        cur.crmQualified += Number(c.crm_qualified) || 0;
        cur.crmSales += Number(c.crm_sales) || 0;
        cur.crmRevenue += Number(c.crm_revenue) || 0;
        crmAgg.set(campaignId, cur);
      }

      const agg = new Map<string, {
        spend: number; impressions: number; clicks: number;
        leads: number; messages: number; purchases: number; revenue: number;
      }>();
      for (const d of daily) {
        const cur = agg.get(d.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0 };
        cur.spend += Number(d.spend) || 0;
        cur.impressions += Number(d.impressions) || 0;
        cur.clicks += Number(d.clicks) || 0;
        cur.leads += Number(d.leads) || 0;
        cur.messages += Number(d.messages) || 0;
        cur.purchases += Number(d.purchases) || 0;
        cur.revenue += Number(d.revenue) || 0;
        agg.set(d.campaign_id, cur);
      }

      const out: MetaCampaignRow[] = camps.map((c) => {
        const a = agg.get(c.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0 };
        const cr = crmAgg.get(c.campaign_id) ?? { crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 };
        const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
        const cpl = a.leads > 0 ? a.spend / a.leads : 0;
        const romi = a.spend > 0 ? ((a.revenue - a.spend) / a.spend) * 100 : 0;
        const crmRomi = a.spend > 0 ? ((cr.crmRevenue - a.spend) / a.spend) * 100 : 0;
        const crmProfit = cr.crmRevenue - a.spend;
        const crmAvgCheck = cr.crmSales > 0 ? cr.crmRevenue / cr.crmSales : 0;
        const crmCps = cr.crmSales > 0 ? a.spend / cr.crmSales : 0;
        return {
          id: c.id,
          campaignId: c.campaign_id,
          cabinetId: c.cabinet_id,
          name: c.name ?? "",
          objective: c.objective,
          destinationType: c.destination_type,
          effectiveStatus: c.effective_status,
          dailyBudget: c.daily_budget != null ? Number(c.daily_budget) : null,
          ...a,
          ctr, cpl, romi,
          ...cr,
          crmRomi, crmProfit, crmAvgCheck, crmCps,
        };
      });
      out.sort((a, b) => b.spend - a.spend);
      setRows(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, since, until, tick]);

  return { rows, loading };
}

// ---------------- Goal labeling helpers ----------------

export type GoalKey =
  | "leads_pixel"
  | "leads_form"
  | "leads"
  | "whatsapp"
  | "messages"
  | "engagement"
  | "traffic"
  | "purchase"
  | "video"
  | "awareness"
  | "other";

export interface GoalMeta {
  key: GoalKey;
  label: string;
  /** Какую метрику считаем «успехом» для этой цели. */
  successMetric: "leads" | "messages" | "purchases" | "clicks" | "impressions";
}

const GOAL_TABLE: Array<{ match: (obj: string, dest: string | null) => boolean; meta: GoalMeta }> = [
  // === Лиды — приоритет, чтобы не перекрылись destination'ом ===
  // OUTCOME_LEADS + WEBSITE → лиды через пиксель на сайте (типичный «Conversion Lead»)
  {
    match: (obj, dest) => /LEAD/.test(obj) && dest === "WEBSITE",
    meta: { key: "leads_pixel", label: "Лиды с сайта (пиксель)", successMetric: "leads" },
  },
  // OUTCOME_LEADS + ON_AD / INSTANT_FORM / LEAD_FORM → instant-форма Meta внутри объявления
  {
    match: (obj, dest) => /LEAD/.test(obj) && !!dest && /(ON_AD|INSTANT_FORM|LEAD_FORM|LEADS_FORM)/.test(dest),
    meta: { key: "leads_form", label: "Лиды через форму Meta", successMetric: "leads" },
  },
  // === Мессенджеры ===
  // WhatsApp — любой destination, содержащий WHATSAPP
  // (чистый WHATSAPP или мультимессенджер MESSAGING_*_WHATSAPP).
  {
    match: (_o, dest) => !!dest && /WHATSAPP/.test(dest),
    meta: { key: "whatsapp", label: "WhatsApp", successMetric: "messages" },
  },
  // Direct / Messenger без WhatsApp
  {
    match: (_o, dest) => dest === "MESSENGER" || dest === "INSTAGRAM_DIRECT",
    meta: { key: "messages", label: "Direct / Messenger", successMetric: "messages" },
  },
  // Лиды без указанного destination — фоллбэк
  {
    match: (obj) => /LEAD/.test(obj),
    meta: { key: "leads", label: "Лиды (форма / сайт)", successMetric: "leads" },
  },
  // === Остальные цели по objective ===
  {
    match: (obj) => /MESSAGE/.test(obj),
    meta: { key: "messages", label: "Сообщения", successMetric: "messages" },
  },
  {
    match: (obj) => /TRAFFIC|LINK_CLICK/.test(obj),
    meta: { key: "traffic", label: "Трафик на сайт", successMetric: "clicks" },
  },
  {
    match: (obj) => /PURCHASE|SALES|CONVERSION/.test(obj),
    meta: { key: "purchase", label: "Продажи / покупки", successMetric: "purchases" },
  },
  // Engagement без destination — взаимодействие с контентом
  {
    match: (obj) => /ENGAGEMENT/.test(obj),
    meta: { key: "engagement", label: "Вовлечённость", successMetric: "messages" },
  },
  {
    match: (obj) => /VIDEO/.test(obj),
    meta: { key: "video", label: "Просмотры видео", successMetric: "impressions" },
  },
  {
    match: (obj) => /AWARENESS|REACH|BRAND/.test(obj),
    meta: { key: "awareness", label: "Охват / узнаваемость", successMetric: "impressions" },
  },
];

export function classifyGoal(objective: string | null, destinationType: string | null): GoalMeta {
  const obj = (objective ?? "").toUpperCase();
  for (const r of GOAL_TABLE) {
    if (r.match(obj, destinationType)) return r.meta;
  }
  return { key: "other", label: objective ?? "Без цели", successMetric: "clicks" };
}
