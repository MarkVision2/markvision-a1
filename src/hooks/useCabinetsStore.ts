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
  provider: (r.provider ?? "meta") as AdCabinet["provider"],
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
    ["provider", "provider"],
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
    // Read from safe view — credentials (access_token, app_id, business_id,
    // page_id, pixel_id) are intentionally excluded. Admins fetch full row
    // separately when opening the edit form via the base table (covered by
    // ad_cabinets_write_admin ALL policy).
    let q = supabase.from("ad_cabinets_safe" as any).select("*").order("created_at", { ascending: false });
    if (projectId) {
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

    // Prefer service-role edge upsert: RLS was historically admin-only, and
    // client INSERT…RETURNING * breaks on access_token column privileges.
    const { data: fnData, error: fnError } = await supabase.functions.invoke(
      "meta-upsert-cabinet",
      {
        body: {
          project_id: projectId,
          id: c.id,
          name: c.name,
          type: c.type,
          provider: c.provider ?? "meta",
          online: c.online !== false,
          ad_account_id: c.adAccountId || c.externalId,
          external_id: c.externalId || c.adAccountId,
          access_token: c.accessToken || null,
          currency: c.currency ?? "KZT",
          daily_budget: c.dailyBudget ?? null,
          city: c.city ?? null,
          page_id: c.pageId ?? null,
          page_name: c.pageName ?? null,
          instagram_id: c.instagramId ?? null,
          telegram_group_id: c.telegramGroupId ?? null,
          whatsapp_number: c.whatsappNumber ?? null,
          pixel_id: c.pixelId ?? null,
          pixel_event: c.pixelEvent ?? "Lead",
          website_url: c.websiteUrl ?? null,
          utm_template: c.utmTemplate ?? null,
          brief: c.brief ?? null,
          business_id: c.businessId ?? null,
        },
      },
    );

    if (!fnError && fnData?.cabinet && !fnData?.error) {
      const saved = toCabinet(fnData.cabinet);
      // Edge already mirrors client_configs under service role; retry only if it failed.
      if (!fnData.client_config_synced) {
        await syncCabinetToClientConfig({
          ...saved,
          accessToken: c.accessToken,
        });
      }
      await refetch();
      return saved.id;
    }

    if (fnData?.error && !fnError) {
      // Function returned 2xx with error payload — don't pretend success.
      console.warn("[addCabinet] meta-upsert-cabinet:", fnData.error);
    }

    // Fallback: direct insert (after RLS migration) without selecting secrets
    const dbRow = {
      ...toDbPatch(c),
      name: c.name,
      created_by: user?.id ?? null,
      project_id: projectId,
    };
    const { data, error } = await supabase
      .from("ad_cabinets")
      .insert(dbRow as any)
      .select(
        "id, project_id, created_by, created_at, updated_at, name, external_id, online, type, provider, currency, daily_budget, spend, leads, lead_cost, sales, revenue, city, ad_account_id, page_id, page_name, instagram_id, telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, landing_url, utm_template, brief",
      )
      .single();

    if (error) {
      const edgeMsg =
        (fnData as { error?: string } | null)?.error
        || (fnError instanceof Error ? fnError.message : null);
      const msg = error.message || edgeMsg || "Не удалось сохранить кабинет";
      if (/row-level security|RLS|permission denied|42501/i.test(msg)) {
        throw new Error(
          "Нет прав записать кабинет в базу. Нужна миграция ad_cabinets_project_member_write или роль admin. "
          + msg,
        );
      }
      throw new Error(msg);
    }

    if (data) {
      await syncCabinetToClientConfig(toCabinet({ ...data, access_token: c.accessToken }));
    }
    await refetch();
    return (data?.id as string) ?? null;
  }, [user?.id, refetch, projectId]);

  const updateCabinet = useCallback(async (id: string, patch: Partial<AdCabinet>) => {
    const dbPatch = toDbPatch(patch);
    // Prefer edge upsert when rotating access_token (column locked for client).
    if (patch.accessToken !== undefined || patch.adAccountId !== undefined) {
      const current = cabinets.find((x) => x.id === id);
      const projectForCab = projectId;
      if (projectForCab) {
        const body: Record<string, unknown> = {
          project_id: projectForCab,
          id,
          name: patch.name ?? current?.name,
          type: patch.type ?? current?.type,
          ad_account_id: patch.adAccountId ?? current?.adAccountId ?? current?.externalId,
          currency: patch.currency ?? current?.currency,
          daily_budget: patch.dailyBudget ?? current?.dailyBudget,
          city: patch.city ?? current?.city,
          page_id: patch.pageId ?? current?.pageId,
          page_name: patch.pageName ?? current?.pageName,
          instagram_id: patch.instagramId ?? current?.instagramId,
          telegram_group_id: patch.telegramGroupId ?? current?.telegramGroupId,
          whatsapp_number: patch.whatsappNumber ?? current?.whatsappNumber,
          pixel_id: patch.pixelId ?? current?.pixelId,
          pixel_event: patch.pixelEvent ?? current?.pixelEvent,
          website_url: patch.websiteUrl ?? current?.websiteUrl,
          utm_template: patch.utmTemplate ?? current?.utmTemplate,
          brief: patch.brief ?? current?.brief,
        };
        if (patch.accessToken !== undefined) {
          body.access_token = patch.accessToken || null;
        }
        const { data: fnData, error: fnError } = await supabase.functions.invoke(
          "meta-upsert-cabinet",
          { body },
        );
        if (!fnError && fnData?.cabinet && !fnData?.error) {
          if (!fnData.client_config_synced) {
            await syncCabinetToClientConfig(toCabinet({
              ...fnData.cabinet,
              access_token: patch.accessToken ?? current?.accessToken,
            }));
          }
          await refetch();
          return;
        }
      }
    }

    const { data, error } = await supabase
      .from("ad_cabinets")
      .update(dbPatch as any)
      .eq("id", id)
      .select(
        "id, project_id, created_by, created_at, updated_at, name, external_id, online, type, provider, currency, daily_budget, spend, leads, lead_cost, sales, revenue, city, ad_account_id, page_id, page_name, instagram_id, telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, landing_url, utm_template, brief",
      )
      .single();
    if (error) throw error;
    if (data) {
      await syncCabinetToClientConfig(toCabinet(data));
    }
    await refetch();
  }, [refetch, cabinets, projectId]);

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
 * Личные и демо-кабинеты (type !== «Агентский») учитываются в KPI.
 */
export function usePersonalCabinets() {
  const { cabinets, ...rest } = useCabinetsStore();
  const personal = useMemo(
    () => cabinets.filter((c) => c.type !== "Агентский"),
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
