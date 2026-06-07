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
  source: string;
  channel: string | null;
  referrer: string | null;
  utm: LeadLiteUtm | null;
  metaAdId: string | null;
  cabinetId: string | null;
  stageKey: string;
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
}

export const LEADS_LITE_QUERY_KEY = "leads-lite";

export async function fetchLeadsLite(activeId: string | null): Promise<LeadLite[]> {
  let leadsQuery = supabase
    .from("leads")
    .select(
      "id,source,channel,referrer,utm,meta_ad_id,cabinet_id,stage_id,amount,diagnostic_amount,created_at,paid_at,last_activity_at,first_response_at,assigned_to,paid,project_id,ai_score,reject_reason,rejected_at",
    )
    .eq("is_personal", false)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (activeId) {
    leadsQuery = leadsQuery.or(`project_id.eq.${activeId},project_id.is.null`);
  }
  const [stagesRes, leadsRes] = await Promise.all([
    supabase.from("pipeline_stages").select("id,key"),
    leadsQuery,
  ]);
  const idToKey = new Map<string, string>();
  for (const s of stagesRes.data ?? []) idToKey.set(s.id, s.key);

  return (leadsRes.data ?? []).map((r) => ({
    id: r.id as string,
    source: (r.source as string) ?? "",
    channel: (r.channel as string | null) ?? null,
    referrer: (r.referrer as string | null) ?? null,
    utm: (r.utm as LeadLiteUtm | null) ?? null,
    metaAdId: (r.meta_ad_id as string | null) ?? null,
    cabinetId: (r.cabinet_id as string | null) ?? null,
    stageKey: idToKey.get(r.stage_id as string) ?? "new",
    amount: Number(r.amount ?? 0),
    diagnosticAmount: Number((r as { diagnostic_amount?: number | null }).diagnostic_amount ?? 0),
    createdAt: r.created_at as string,
    paidAt: (r.paid_at as string | null) ?? null,
    lastActivityAt: r.last_activity_at as string,
    firstResponseAt: (r.first_response_at as string | null) ?? null,
    assigneeId: (r.assigned_to as string | null) ?? null,
    paid: Boolean(r.paid),
    aiScore: Number((r as { ai_score?: number | null }).ai_score ?? 0),
    scoreLabel: ((r as { score_label?: string | null }).score_label ?? null) as string | null,
    rejectReason: ((r as { reject_reason?: string | null }).reject_reason ?? null) as string | null,
    rejectedAt: ((r as { rejected_at?: string | null }).rejected_at ?? null) as string | null,
    stageId: (r.stage_id as string | null) ?? null,
  }));
}

export function useLeadsLite() {
  const { activeId } = useProjectsStore();
  const queryClient = useQueryClient();

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [LEADS_LITE_QUERY_KEY, activeId] });
  }, [queryClient, activeId]);

  useRealtimeTable("leads", refetch, true, 600);

  const { data: leads = [], isLoading: loading } = useQuery({
    queryKey: [LEADS_LITE_QUERY_KEY, activeId],
    queryFn: () => fetchLeadsLite(activeId),
  });

  return { leads, loading, refetch };
}
