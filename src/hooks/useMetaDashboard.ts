import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  aggregateCreativeCrmFromDaily,
  aggregateCreativeCrmFromLeads,
  mergeCreativeCrmMaps,
} from "@/lib/creativeCrmMetrics";
import { fetchLeadsLite } from "./useLeadsLite";
import { useProjectsStore } from "./useProjectsStore";
import { useRealtimeTable } from "./useRealtimeTable";
import type { MetaCampaignRow, MetaCreativeRow } from "./useMetaStructure";

export const META_STRUCTURE_QUERY_KEY = "meta-structure";

/** PostgREST default max-rows is 1000 — page until exhausted. */
const PAGE_SIZE = 1000;
const IN_CHUNK = 150;

interface Range { from: Date; to: Date }

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
  link_clicks?: number | string | null;
  leads: number | string;
  messages: number | string;
  purchases: number | string;
  revenue: number | string;
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
  link_clicks?: number | string | null;
  leads: number | string;
  messages: number | string;
  purchases: number | string;
  revenue: number | string;
}

type DailyMetricBag = {
  spend: number;
  impressions: number;
  clicks: number;
  /** Клики по ссылке — по ним CTR/CPC, как в Ads Manager. */
  linkClicks: number;
  leads: number;
  messages: number;
  purchases: number;
  revenue: number;
};

function emptyMetrics(): DailyMetricBag {
  return { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0 };
}

function accumulateDaily(
  agg: Map<string, DailyMetricBag>,
  key: string,
  d: {
    spend: number | string;
    impressions: number | string;
    clicks: number | string;
    link_clicks?: number | string | null;
    leads: number | string;
    messages: number | string;
    purchases: number | string;
    revenue: number | string;
  },
) {
  const cur = agg.get(key) ?? emptyMetrics();
  cur.spend += Number(d.spend) || 0;
  cur.impressions += Number(d.impressions) || 0;
  cur.clicks += Number(d.clicks) || 0;
  cur.linkClicks += Number(d.link_clicks) || 0;
  cur.leads += Number(d.leads) || 0;
  cur.messages += Number(d.messages) || 0;
  cur.purchases += Number(d.purchases) || 0;
  cur.revenue += Number(d.revenue) || 0;
  agg.set(key, cur);
}

function sumSpend(agg: Map<string, DailyMetricBag>): number {
  let s = 0;
  for (const v of agg.values()) s += v.spend;
  return s;
}

/**
 * link_clicks появился миграцией 20260903120000. Пока она не применена, читаем
 * без него — иначе вкладки «Креативы»/«Кампании» падали бы на неизвестной колонке.
 */
let linkClicksAvailable = true;

const CREATIVE_DAILY_BASE = "ad_id, spend, impressions, clicks, leads, messages, purchases, revenue";
const CAMPAIGN_DAILY_BASE = "campaign_id, spend, impressions, clicks, leads, messages, purchases, revenue";

const creativeDailySelect = () =>
  linkClicksAvailable ? `${CREATIVE_DAILY_BASE}, link_clicks` : CREATIVE_DAILY_BASE;
const campaignDailySelect = () =>
  linkClicksAvailable ? `${CAMPAIGN_DAILY_BASE}, link_clicks` : CAMPAIGN_DAILY_BASE;

function isMissingLinkClicks(message: string): boolean {
  return /link_clicks/i.test(message);
}

async function fetchPaged<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let { data, error } = await runPage(from, from + PAGE_SIZE - 1);
    if (error && isMissingLinkClicks(error.message) && linkClicksAvailable) {
      linkClicksAvailable = false;
      ({ data, error } = await runPage(from, from + PAGE_SIZE - 1));
    }
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return out;
}

function chunkIds(ids: string[], size = IN_CHUNK): string[][] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}

async function fetchCreatives(projectId: string): Promise<RawCreative[]> {
  return fetchPaged((from, to) =>
    supabase
      .from("meta_creatives")
      .select(
        "id, ad_id, campaign_id, cabinet_id, name, creative_type, thumbnail_url, image_url, poster_url, video_url, video_id, primary_text, headline, cta, destination_url, effective_status",
      )
      .eq("project_id", projectId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

async function fetchCampaigns(projectId: string): Promise<RawCampaign[]> {
  return fetchPaged((from, to) =>
    supabase
      .from("meta_campaigns")
      .select("id, campaign_id, cabinet_id, name, objective, destination_type, effective_status, daily_budget")
      .eq("project_id", projectId)
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/**
 * Period metrics for creatives.
 * Primary: filter by project_id (indexed).
 * Fallback: by ad_id from project's creatives — covers rows with null/wrong project_id.
 */
async function fetchCreativeDailyByProject(
  projectId: string,
  since: string,
  until: string,
): Promise<RawDailyAgg[]> {
  return fetchPaged((from, to) =>
    supabase
      .from("meta_creative_daily")
      .select(creativeDailySelect() as "*")
      .eq("project_id", projectId)
      .gte("date", since)
      .lte("date", until)
      .order("ad_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, to),
  );
}

async function fetchCreativeDailyByAdIds(
  adIds: string[],
  since: string,
  until: string,
): Promise<RawDailyAgg[]> {
  if (adIds.length === 0) return [];
  const out: RawDailyAgg[] = [];
  for (const ids of chunkIds(adIds)) {
    const page = await fetchPaged<RawDailyAgg>((from, to) =>
      supabase
        .from("meta_creative_daily")
        .select(creativeDailySelect() as "*")
        .in("ad_id", ids)
        .gte("date", since)
        .lte("date", until)
        .order("ad_id", { ascending: true })
        .order("date", { ascending: true })
        .range(from, to),
    );
    out.push(...page);
  }
  return out;
}

async function fetchCampaignDailyByProject(
  projectId: string,
  since: string,
  until: string,
): Promise<RawCampaignDaily[]> {
  return fetchPaged((from, to) =>
    supabase
      .from("meta_campaign_daily")
      .select(campaignDailySelect() as "*")
      .eq("project_id", projectId)
      .gte("date", since)
      .lte("date", until)
      .order("campaign_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, to),
  );
}

async function fetchCampaignDailyByIds(
  campaignIds: string[],
  since: string,
  until: string,
): Promise<RawCampaignDaily[]> {
  if (campaignIds.length === 0) return [];
  const out: RawCampaignDaily[] = [];
  for (const ids of chunkIds(campaignIds)) {
    const page = await fetchPaged<RawCampaignDaily>((from, to) =>
      supabase
        .from("meta_campaign_daily")
        .select(campaignDailySelect() as "*")
        .in("campaign_id", ids)
        .gte("date", since)
        .lte("date", until)
        .order("campaign_id", { ascending: true })
        .order("date", { ascending: true })
        .range(from, to),
    );
    out.push(...page);
  }
  return out;
}

async function fetchCrmDaily(
  projectId: string,
  since: string,
  until: string,
  adIds: string[],
) {
  const crmTable = (supabase as any).from("meta_creative_crm_daily");
  type CrmRow = {
    ad_id: string;
    crm_leads: number | string;
    crm_qualified: number | string;
    crm_sales: number | string;
    crm_revenue: number | string;
    crm_diagnostics?: number | string;
    crm_diagnostic_revenue?: number | string;
  };

  let rows: CrmRow[] = [];
  try {
    rows = await fetchPaged<CrmRow>((from, to) =>
      crmTable
        .select("ad_id, crm_leads, crm_qualified, crm_sales, crm_revenue, crm_diagnostics, crm_diagnostic_revenue")
        .eq("project_id", projectId)
        .gte("date", since)
        .lte("date", until)
        .order("ad_id", { ascending: true })
        .range(from, to),
    );
  } catch {
    rows = [];
  }

  const crmSpendProxy = rows.reduce((s, r) => s + (Number(r.crm_leads) || 0), 0);
  if (crmSpendProxy === 0 && adIds.length > 0) {
    try {
      const extra: CrmRow[] = [];
      for (const ids of chunkIds(adIds)) {
        const page = await fetchPaged<CrmRow>((from, to) =>
          crmTable
            .select("ad_id, crm_leads, crm_qualified, crm_sales, crm_revenue, crm_diagnostics, crm_diagnostic_revenue")
            .in("ad_id", ids)
            .gte("date", since)
            .lte("date", until)
            .order("ad_id", { ascending: true })
            .range(from, to),
        );
        extra.push(...page);
      }
      if (extra.length > rows.length) rows = extra;
    } catch {
      /* view may be missing */
    }
  }

  return rows;
}

export async function fetchMetaDashboard(
  projectId: string,
  since: string,
  until: string,
): Promise<{ creatives: MetaCreativeRow[]; campaigns: MetaCampaignRow[] }> {
  const [creatives, camps, leads] = await Promise.all([
    fetchCreatives(projectId),
    fetchCampaigns(projectId),
    fetchLeadsLite(projectId),
  ]);

  const adIds = creatives.map((c) => c.ad_id).filter(Boolean);
  const campaignIds = camps.map((c) => c.campaign_id).filter(Boolean);

  const [dailyInitial, campDailyInitial, crm] = await Promise.all([
    fetchCreativeDailyByProject(projectId, since, until),
    fetchCampaignDailyByProject(projectId, since, until),
    fetchCrmDaily(projectId, since, until, adIds),
  ]);
  let daily = dailyInitial;
  let campDaily = campDailyInitial;

  const creativeAgg = new Map<string, DailyMetricBag>();
  for (const d of daily) accumulateDaily(creativeAgg, d.ad_id, d);

  // Rows with null/mismatched project_id never appear in the project filter —
  // re-fetch by the creatives we already own for this project.
  if (sumSpend(creativeAgg) === 0 && adIds.length > 0) {
    daily = await fetchCreativeDailyByAdIds(adIds, since, until);
    creativeAgg.clear();
    for (const d of daily) accumulateDaily(creativeAgg, d.ad_id, d);
  }

  const campAgg = new Map<string, DailyMetricBag>();
  for (const d of campDaily) accumulateDaily(campAgg, d.campaign_id, d);
  if (sumSpend(campAgg) === 0 && campaignIds.length > 0) {
    campDaily = await fetchCampaignDailyByIds(campaignIds, since, until);
    campAgg.clear();
    for (const d of campDaily) accumulateDaily(campAgg, d.campaign_id, d);
  }

  // If campaign daily is still empty but creative daily has spend, roll up by campaign_id.
  if (sumSpend(campAgg) === 0 && sumSpend(creativeAgg) > 0) {
    const creativeById = new Map(creatives.map((c) => [c.ad_id, c.campaign_id]));
    for (const [adId, metrics] of creativeAgg) {
      const campaignId = creativeById.get(adId);
      if (!campaignId) continue;
      const cur = campAgg.get(campaignId) ?? emptyMetrics();
      cur.spend += metrics.spend;
      cur.impressions += metrics.impressions;
      cur.clicks += metrics.clicks;
      cur.leads += metrics.leads;
      cur.messages += metrics.messages;
      cur.purchases += metrics.purchases;
      cur.revenue += metrics.revenue;
      campAgg.set(campaignId, cur);
    }
  }

  const range = {
    from: new Date(`${since}T00:00:00`),
    to: new Date(`${until}T00:00:00`),
  };
  const crmFromView = aggregateCreativeCrmFromDaily(crm);
  const crmFromLeads = aggregateCreativeCrmFromLeads(
    leads.map((l) => ({
      metaAdId: l.metaAdId,
      createdAt: l.createdAt,
      paidAt: l.paidAt,
      lastActivityAt: l.lastActivityAt,
      stageKey: l.stageKey,
      amount: l.amount,
      diagnosticAmount: l.diagnosticAmount,
      paid: l.paid,
    })),
    range,
  );
  const crmAgg = mergeCreativeCrmMaps(crmFromView, crmFromLeads);

  const creativeRows: MetaCreativeRow[] = creatives.map((c) => {
    const a = creativeAgg.get(c.ad_id) ?? emptyMetrics();
    const cr = crmAgg.get(c.ad_id) ?? {
      crmLeads: 0,
      crmQualified: 0,
      crmSales: 0,
      crmDiagnostics: 0,
      crmRevenue: 0,
    };
    const ctrClicks = a.linkClicks > 0 ? a.linkClicks : a.clicks;
    const ctr = a.impressions > 0 ? (ctrClicks / a.impressions) * 100 : 0;
    const cpl = a.leads > 0 ? a.spend / a.leads : 0;
    const cpc = ctrClicks > 0 ? a.spend / ctrClicks : 0;
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
      crmLeads: cr.crmLeads,
      crmQualified: cr.crmQualified,
      crmSales: cr.crmSales,
      crmDiagnostics: cr.crmDiagnostics,
      crmRevenue: cr.crmRevenue,
      crmCpl, crmCps, crmAvgCheck, crmRomi, crmProfit,
    };
  });
  creativeRows.sort((a, b) => b.spend - a.spend);

  const creativeMap = new Map<string, string>();
  for (const c of creatives) {
    if (c.campaign_id) creativeMap.set(c.ad_id, c.campaign_id);
  }
  const crmByCampaign = new Map<string, { crmLeads: number; crmQualified: number; crmSales: number; crmRevenue: number }>();
  for (const [adId, cr] of crmAgg) {
    const campaignId = creativeMap.get(adId);
    if (!campaignId) continue;
    const cur = crmByCampaign.get(campaignId) ?? { crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 };
    cur.crmLeads += cr.crmLeads;
    cur.crmQualified += cr.crmQualified;
    cur.crmSales += cr.crmSales;
    cur.crmRevenue += cr.crmRevenue;
    crmByCampaign.set(campaignId, cur);
  }

  const campaignRows: MetaCampaignRow[] = camps.map((c) => {
    const a = campAgg.get(c.campaign_id) ?? emptyMetrics();
    const cr = crmByCampaign.get(c.campaign_id) ?? { crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 };
    const ctrClicks = a.linkClicks > 0 ? a.linkClicks : a.clicks;
    const ctr = a.impressions > 0 ? (ctrClicks / a.impressions) * 100 : 0;
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
  campaignRows.sort((a, b) => b.spend - a.spend);

  return { creatives: creativeRows, campaigns: campaignRows };
}

export function useMetaDashboard(range: Range) {
  const { activeId: projectId } = useProjectsStore();
  const queryClient = useQueryClient();
  const since = useMemo(() => ymd(range.from), [range.from]);
  const until = useMemo(() => ymd(range.to), [range.to]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [META_STRUCTURE_QUERY_KEY, projectId, since, until] });
  }, [queryClient, projectId, since, until]);

  useRealtimeTable("meta_creative_daily", invalidate, true, 2000);
  useRealtimeTable("meta_creatives", invalidate, true, 1000);
  useRealtimeTable("meta_campaigns", invalidate, true, 1000);
  useRealtimeTable("meta_campaign_daily", invalidate, true, 2000);
  useRealtimeTable("leads", invalidate, true, 2000);

  const { data, isLoading: loading } = useQuery({
    queryKey: [META_STRUCTURE_QUERY_KEY, projectId, since, until],
    queryFn: () => fetchMetaDashboard(projectId!, since, until),
    enabled: !!projectId,
  });

  return {
    creatives: data?.creatives ?? [],
    campaigns: data?.campaigns ?? [],
    loading,
  };
}
