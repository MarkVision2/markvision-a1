// Lightweight leads hook for Analytics / Dashboard / Reports.
// Loads ONLY columns needed for KPI/charts — no communications, no events,
// no history. Cached via React Query so multiple hooks share one fetch + realtime.
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface LeadLiteUtm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
}

export interface LeadLite {
  id: string;
  projectId: string | null;
  source: string;
  channel: string | null;
  referrer: string | null;
  landingUrl?: string | null;
  utm: LeadLiteUtm | null;
  metaAdId: string | null;
  /** ctwa_clid / fbclid для WhatsApp-лида — признак перехода по рекламе Meta. */
  clickId: string | null;
  cabinetId: string | null;
  stageKey: string;
  stageRole?: string | null;
  amount: number;
  diagnosticAmount: number;
  createdAt: string;
  paidAt: string | null;
  lastActivityAt: string;
  firstResponseAt: string | null;
  assigneeId: string | null;
  paid: boolean;
  aiScore: number;
  scoreLabel: string | null;
  rejectReason: string | null;
  rejectedAt: string | null;
  stageId: string | null;
  nextVisitAt: string | null;
  paymentMethod: string | null;
  tags?: string[] | null;
  temperature?: string | null;
  webinarStatus?: string | null;
  depositAmount?: number | null;
}

export const LEADS_LITE_QUERY_KEY = "leads-lite";

export async function fetchLeadsLite(activeId: string | null): Promise<LeadLite[]> {
  let leadsQuery = supabase
    .from("leads")
    .select(
      "id,source,channel,referrer,landing_url,utm,meta_ad_id,click_id,cabinet_id,stage_id,amount,diagnostic_amount,created_at,paid_at,last_activity_at,first_response_at,assigned_to,paid,project_id,ai_score,reject_reason,rejected_at,next_visit_at,payment_method,tags,temperature,webinar_status,deposit_amount",
    )
    .eq("is_personal", false)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (activeId) {
    leadsQuery = leadsQuery.eq("project_id", activeId);
  }
  const [stagesRes, leadsRes] = await Promise.all([
    supabase.from("pipeline_stages").select("id,key,stage_role"),
    leadsQuery,
  ]);
  const idToKey = new Map<string, string>();
  const idToRole = new Map<string, string>();
  for (const s of (stagesRes.data ?? []) as unknown as Array<{ id: string; key: string; stage_role?: string }>) {
    idToKey.set(s.id, s.key);
    if (s.stage_role) {
      idToRole.set(s.id, s.stage_role);
    }
  }

  return ((leadsRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    projectId: (r.project_id as string | null) ?? null,
    source: (r.source as string) ?? "",
    channel: (r.channel as string | null) ?? null,
    referrer: (r.referrer as string | null) ?? null,
    landingUrl: (r.landing_url as string | null) ?? null,
    utm: (r.utm as LeadLiteUtm | null) ?? null,
    metaAdId: (r.meta_ad_id as string | null) ?? null,
    clickId: (r.click_id as string | null) ?? null,
    cabinetId: (r.cabinet_id as string | null) ?? null,
    stageKey: idToKey.get(r.stage_id as string) ?? "new",
    stageRole: idToRole.get(r.stage_id as string) ?? null,
    amount: Number(r.amount ?? 0),
    diagnosticAmount: Number((r.diagnostic_amount as number | null) ?? 0),
    createdAt: r.created_at as string,
    paidAt: (r.paid_at as string | null) ?? null,
    lastActivityAt: r.last_activity_at as string,
    firstResponseAt: (r.first_response_at as string | null) ?? null,
    assigneeId: (r.assigned_to as string | null) ?? null,
    paid: Boolean(r.paid),
    aiScore: Number((r.ai_score as number | null) ?? 0),
    scoreLabel: ((r.score_label as string | null) ?? null),
    rejectReason: ((r.reject_reason as string | null) ?? null),
    rejectedAt: ((r.rejected_at as string | null) ?? null),
    stageId: (r.stage_id as string | null) ?? null,
    nextVisitAt: (r.next_visit_at as string | null) ?? null,
    paymentMethod: (r.payment_method as string | null) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    temperature: ((r.temperature as string | null) ?? null),
    webinarStatus: ((r.webinar_status as string | null) ?? null),
    depositAmount: Number((r.deposit_amount as number | null) ?? 0) || null,
  }));
}

/**
 * Стабильная ссылка на пустой список.
 *
 * `useQuery({...})` с дефолтом `= []` создаёт НОВЫЙ массив на каждом рендере,
 * пока данные грузятся. useCrmFlow держит этот массив в зависимостях эффекта и
 * внутри вызывает setState — получался цикл «эффект → рендер → новый [] →
 * эффект», который крутился до конца загрузки (на дашборде это ~180 рендеров
 * и предупреждение React «Maximum update depth exceeded»).
 */
const NO_LEADS: LeadLite[] = [];

export function useLeadsLite() {
  const { activeId } = useProjectsStore();
  const queryClient = useQueryClient();

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [LEADS_LITE_QUERY_KEY, activeId] });
  }, [queryClient, activeId]);

  useRealtimeTable("leads", refetch, true, 600);

  const { data: leads = NO_LEADS, isLoading: loading } = useQuery({
    queryKey: [LEADS_LITE_QUERY_KEY, activeId],
    queryFn: () => fetchLeadsLite(activeId),
  });

  return { leads, loading, refetch };
}
