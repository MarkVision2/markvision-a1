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
  leads: number | string;
  messages: number | string;
  purchases: number | string;
  revenue: number | string;
}

export async function fetchMetaDashboard(
  projectId: string,
  since: string,
  until: string,
): Promise<{ creatives: MetaCreativeRow[]; campaigns: MetaCampaignRow[] }> {
  const crmTable = (supabase as any).from("meta_creative_crm_daily");


  const [creativesRes, dailyRes, crmRes, campsRes, campDailyRes, leads] = await Promise.all([
    supabase
      .from("meta_creatives")
      .select(
        "id, ad_id, campaign_id, cabinet_id, name, creative_type, thumbnail_url, image_url, poster_url, video_url, video_id, primary_text, headline, cta, destination_url, effective_status",
      )
      .eq("project_id", projectId)
      .limit(500),
    supabase
      .from("meta_creative_daily")
      .select("ad_id, spend, impressions, clicks, leads, messages, purchases, revenue")
      .eq("project_id", projectId)
      .gte("date", since)
      .lte("date", until),
    crmTable
      .select("ad_id, crm_leads, crm_qualified, crm_sales, crm_revenue, crm_diagnostics, crm_diagnostic_revenue")
      .eq("project_id", projectId)
      .gte("date", since)
      .lte("date", until),
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
    fetchLeadsLite(projectId),
  ]);

  const creatives = (creativesRes.data ?? []) as RawCreative[];
  const daily = (dailyRes.data ?? []) as RawDailyAgg[];
  const crm = ((crmRes.data ?? []) as unknown) as Array<{
    ad_id: string;
    crm_leads: number | string;
    crm_qualified: number | string;
    crm_sales: number | string;
    crm_revenue: number | string;
    crm_diagnostics?: number | string;
    crm_diagnostic_revenue?: number | string;
  }>;

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
      crmLeads: cr.crmLeads,
      crmQualified: cr.crmQualified,
      crmSales: cr.crmSales,
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

  const camps = (campsRes.data ?? []) as RawCampaign[];
  const campDaily = (campDailyRes.data ?? []) as RawCampaignDaily[];
  const campAgg = new Map<string, {
    spend: number; impressions: number; clicks: number;
    leads: number; messages: number; purchases: number; revenue: number;
  }>();
  for (const d of campDaily) {
    const cur = campAgg.get(d.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0 };
    cur.spend += Number(d.spend) || 0;
    cur.impressions += Number(d.impressions) || 0;
    cur.clicks += Number(d.clicks) || 0;
    cur.leads += Number(d.leads) || 0;
    cur.messages += Number(d.messages) || 0;
    cur.purchases += Number(d.purchases) || 0;
    cur.revenue += Number(d.revenue) || 0;
    campAgg.set(d.campaign_id, cur);
  }

  const campaignRows: MetaCampaignRow[] = camps.map((c) => {
    const a = campAgg.get(c.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0 };
    const cr = crmByCampaign.get(c.campaign_id) ?? { crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 };
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
