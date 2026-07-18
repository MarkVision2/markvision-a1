import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import type { CampaignLaunchRow } from "@/lib/campaignWorkspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function mapLaunch(row: Record<string, unknown>): CampaignLaunchRow {
  return {
    id: String(row.id),
    cabinetId: (row.cabinet_id as string | null) ?? null,
    goal: String(row.goal ?? ""),
    budget: (row.budget as string | null) ?? null,
    text: (row.text as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    statusStep: (row.status_step as string | null) ?? null,
    statusMessage: (row.status_message as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    metaCampaignId: (row.meta_campaign_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  };
}

export function useAdCampaignLaunches() {
  const { activeId: projectId } = useProjectsStore();
  const [launches, setLaunches] = useState<CampaignLaunchRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setLaunches([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await db
        .from("ad_campaigns")
        .select("id,cabinet_id,goal,budget,text,status,status_step,status_message,last_error,meta_campaign_id,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      setLaunches((data ?? []).map(mapLaunch));
    } catch {
      setLaunches([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRealtimeTable("ad_campaigns", refetch);

  return { launches, loading, refetch };
}
