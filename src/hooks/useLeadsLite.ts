// Lightweight leads hook for Analytics / Dashboard / Reports.
// Loads ONLY columns needed for KPI/charts — no communications, no events,
// no history. This avoids the heavy useCrmStore (5 tables × N rows + 6 realtime
// subscriptions) on pages that just need aggregate numbers.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export interface LeadLite {
  id: string;
  source: string;
  stageKey: string; // resolved key (e.g. "new"), not stage uuid
  amount: number;
  createdAt: string;
  lastActivityAt: string;
  firstResponseAt: string | null;
  assigneeId: string | null;
  paid: boolean;
}

export function useLeadsLite() {
  const [leads, setLeads] = useState<LeadLite[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    // Resolve stage uuid → key in a single small query (cached)
    const [stagesRes, leadsRes] = await Promise.all([
      supabase.from("pipeline_stages").select("id,key"),
      supabase
        .from("leads")
        .select(
          "id,source,stage_id,amount,created_at,last_activity_at,first_response_at,assigned_to,paid",
        )
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
    const idToKey = new Map<string, string>();
    for (const s of stagesRes.data ?? []) idToKey.set(s.id, s.key);

    const list: LeadLite[] = (leadsRes.data ?? []).map((r) => ({
      id: r.id as string,
      source: (r.source as string) ?? "",
      stageKey: idToKey.get(r.stage_id as string) ?? "new",
      amount: Number(r.amount ?? 0),
      createdAt: r.created_at as string,
      lastActivityAt: r.last_activity_at as string,
      firstResponseAt: (r.first_response_at as string | null) ?? null,
      assigneeId: (r.assigned_to as string | null) ?? null,
      paid: Boolean(r.paid),
    }));
    setLeads(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Single debounced realtime subscription on the leads table only.
  useRealtimeTable("leads", refetch, true, 600);

  return { leads, loading, refetch };
}
