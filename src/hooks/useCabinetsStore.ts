import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  syncCabinetToClientConfig,
  deleteCabinetFromClientConfig,
} from "@/lib/cabinetSync";
import type { AdCabinet } from "@/types/ads";

const toCabinet = (r: any): AdCabinet => ({
  id: r.id,
  name: r.name,
  externalId: r.external_id ?? "",
  online: !!r.online,
  type: r.type as AdCabinet["type"],
  spend: Number(r.spend ?? 0),
  leads: Number(r.leads ?? 0),
  leadCost: Number(r.lead_cost ?? 0),
  sales: Number(r.sales ?? 0),
  revenue: Number(r.revenue ?? 0),
  // Основное
  city: r.city ?? undefined,
  dailyBudget: r.daily_budget != null ? Number(r.daily_budget) : 0,
  currency: r.currency ?? "KZT",
  // Meta
  adAccountId: r.ad_account_id ?? undefined,
  pageId: r.page_id ?? undefined,
  pageName: r.page_name ?? undefined,
  instagramId: r.instagram_id ?? undefined,
  // Трекинг
  telegramGroupId: r.telegram_group_id ?? undefined,
  whatsappNumber: r.whatsapp_number ?? undefined,
  pixelId: r.pixel_id ?? undefined,
  pixelEvent: r.pixel_event ?? "Lead",
  websiteUrl: r.website_url ?? undefined,
  // Заметки
  brief: r.brief ?? undefined,
  // Унаследованные
  accessToken: r.access_token ?? undefined,
  appId: r.app_id ?? undefined,
  businessId: r.business_id ?? undefined,
  campaignObjective: r.campaign_objective ?? undefined,
  optimizationGoal: r.optimization_goal ?? undefined,
  leadFormId: r.lead_form_id ?? undefined,
  startTime: r.start_time ?? undefined,
  endTime: r.end_time ?? undefined,
  daysOfWeek: r.days_of_week ?? [1, 2, 3, 4, 5, 6, 7],
  timezone: r.timezone ?? "Asia/Almaty",
  autoLaunchEnabled: !!r.auto_launch_enabled,
  launchHour: r.launch_hour ?? 9,
  targetGeo: r.target_geo ?? [],
  targetAgeMin: r.target_age_min ?? undefined,
  targetAgeMax: r.target_age_max ?? undefined,
  targetGender: (r.target_gender ?? "all") as AdCabinet["targetGender"],
  targetLanguages: r.target_languages ?? [],
  targetInterests: Array.isArray(r.target_interests) ? r.target_interests : [],
  targetExclusions: Array.isArray(r.target_exclusions) ? r.target_exclusions : [],
  creativeHeadline: r.creative_headline ?? undefined,
  creativePrimaryText: r.creative_primary_text ?? undefined,
  creativeDescription: r.creative_description ?? undefined,
  creativeCta: r.creative_cta ?? undefined,
  creativeMediaUrls: r.creative_media_urls ?? [],
  landingUrl: r.landing_url ?? undefined,
  utmTemplate: r.utm_template ?? undefined,
});

const toDbPatch = (patch: Partial<AdCabinet>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const map: Array<[keyof AdCabinet, string]> = [
    ["name", "name"],
    ["externalId", "external_id"],
    ["online", "online"],
    ["type", "type"],
    ["spend", "spend"],
    ["leads", "leads"],
    ["leadCost", "lead_cost"],
    ["sales", "sales"],
    ["revenue", "revenue"],
    ["city", "city"],
    ["dailyBudget", "daily_budget"],
    ["currency", "currency"],
    ["adAccountId", "ad_account_id"],
    ["pageId", "page_id"],
    ["pageName", "page_name"],
    ["instagramId", "instagram_id"],
    ["telegramGroupId", "telegram_group_id"],
    ["whatsappNumber", "whatsapp_number"],
    ["pixelId", "pixel_id"],
    ["pixelEvent", "pixel_event"],
    ["websiteUrl", "website_url"],
    ["brief", "brief"],
    ["accessToken", "access_token"],
    ["appId", "app_id"],
    ["businessId", "business_id"],
    ["campaignObjective", "campaign_objective"],
    ["optimizationGoal", "optimization_goal"],
    ["leadFormId", "lead_form_id"],
    ["startTime", "start_time"],
    ["endTime", "end_time"],
    ["daysOfWeek", "days_of_week"],
    ["timezone", "timezone"],
    ["autoLaunchEnabled", "auto_launch_enabled"],
    ["launchHour", "launch_hour"],
    ["targetGeo", "target_geo"],
    ["targetAgeMin", "target_age_min"],
    ["targetAgeMax", "target_age_max"],
    ["targetGender", "target_gender"],
    ["targetLanguages", "target_languages"],
    ["targetInterests", "target_interests"],
    ["targetExclusions", "target_exclusions"],
    ["creativeHeadline", "creative_headline"],
    ["creativePrimaryText", "creative_primary_text"],
    ["creativeDescription", "creative_description"],
    ["creativeCta", "creative_cta"],
    ["creativeMediaUrls", "creative_media_urls"],
    ["landingUrl", "landing_url"],
    ["utmTemplate", "utm_template"],
  ];
  for (const [k, dbKey] of map) {
    if (patch[k] !== undefined) out[dbKey] = patch[k] as unknown;
  }
  return out;
};

export function useCabinetsStore() {
  const { user } = useAuth();
  const { activeId: projectId } = useProjectsStore();
  const [cabinets, setCabinets] = useState<AdCabinet[]>(() => []);

  const refetch = useCallback(async () => {
    let q = supabase.from("ad_cabinets").select("*").order("created_at", { ascending: false });
    if (projectId) {
      // Show project-scoped cabinets + legacy rows without project_id
      q = q.or(`project_id.eq.${projectId},project_id.is.null`);
    }
    const { data } = await q;
    setCabinets((data ?? []).map(toCabinet));
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("ad_cabinets", refetch);

  const addCabinet = useCallback(async (c: AdCabinet) => {
    if (!projectId) {
      throw new Error("Сначала создайте проект и сделайте его активным");
    }
    const dbRow = {
      ...toDbPatch(c),
      name: c.name,
      created_by: user?.id ?? null,
      project_id: projectId,
    };
    const { data, error } = await supabase
      .from("ad_cabinets")
      .insert(dbRow as any)
      .select("*")
      .single();
    if (error) throw error;
    // Зеркалим в client config supabase (туда смотрят n8n + content factory).
    // Используем серверный id (real UUID), а не c.id — фронт может слать
    // временный slug, реальный id выдаёт DB.
    if (data) {
      await syncCabinetToClientConfig(toCabinet(data));
    }
    await refetch();
    return (data?.id as string) ?? null;
  }, [user?.id, refetch, projectId]);

  const updateCabinet = useCallback(async (id: string, patch: Partial<AdCabinet>) => {
    const { data, error } = await supabase
      .from("ad_cabinets")
      .update(toDbPatch(patch) as any)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    // Перезеркалить актуальный снимок строки.
    if (data) {
      await syncCabinetToClientConfig(toCabinet(data));
    }
    await refetch();
  }, [refetch]);

  const removeCabinet = useCallback(async (id: string) => {
    await supabase.from("ad_cabinets").delete().eq("id", id);
    await deleteCabinetFromClientConfig(id);
    await refetch();
  }, [refetch]);

  return { cabinets, addCabinet, updateCabinet, removeCabinet };
}

/**
 * Кабинеты, которые попадают во все аналитические разделы проекта
 * (Дашборд, Сквозная аналитика, Таблица показателей, Отчётность, CRM).
 * Агентские кабинеты исключаются — они видны только в списке /ads.
 */
export function usePersonalCabinets() {
  const { cabinets, ...rest } = useCabinetsStore();
  const personal = useMemo(
    () => cabinets.filter((c) => c.type === "Личный"),
    [cabinets],
  );
  return { cabinets: personal, ...rest };
}

export type CampaignDraft = {
  id: string;
  cabinetId: string;
  goal: string;
  budget: string;
  text: string;
  whatsappId?: string;
  pixelId?: string;
  pixelEvent?: string;
  leadFormId?: string;
  launchId?: string;
  status?: string;
  createdAt: string;
};

export async function saveCampaign(
  draft: Omit<CampaignDraft, "id" | "createdAt">,
  projectId?: string | null,
) {
  const { data, error } = await supabase
    .from("ad_campaigns")
    .insert({
      cabinet_id: draft.cabinetId,
      goal: draft.goal,
      budget: draft.budget,
      text: draft.text,
      whatsapp_id: draft.whatsappId ?? null,
      pixel_id: draft.pixelId ?? null,
      pixel_event: draft.pixelEvent ?? null,
      lead_form_id: draft.leadFormId ?? null,
      project_id: projectId ?? null,
      launch_id: draft.launchId ?? null,
      status: draft.status ?? "queued",
      status_updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error || !data) throw error;
  return {
    id: data.id,
    cabinetId: data.cabinet_id,
    goal: data.goal,
    budget: data.budget,
    text: data.text,
    whatsappId: (data as any).whatsapp_id ?? undefined,
    pixelId: (data as any).pixel_id ?? undefined,
    pixelEvent: (data as any).pixel_event ?? undefined,
    leadFormId: (data as any).lead_form_id ?? undefined,
    launchId: (data as any).launch_id ?? undefined,
    status: (data as any).status ?? undefined,
    createdAt: data.created_at,
  } as CampaignDraft;
}
