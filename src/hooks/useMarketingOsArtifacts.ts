import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export type MarketingOsCommand = "creatives" | "content" | "site_brief" | "site_build";
export type MarketingOsStatus = "pending" | "running" | "done" | "error";

export interface MarketingOsArtifact {
  id: string;
  project_id: string;
  command: MarketingOsCommand;
  status: MarketingOsStatus;
  markdown: string | null;
  payload: Record<string, unknown> | null;
  error: string | null;
  updated_at: string;
}

export interface ProjectBrief {
  project_id: string;
  brief_md: string | null;
  product_type: string | null;
  segments: unknown[] | null;
  competitors: unknown | null;
  product_matrix: Record<string, string> | null;
  launch_scenarios: unknown[] | null;
  recommended_scenario: string | null;
  ai_variants: unknown[] | null;
  niche: string | null;
  product: string | null;
  audience: string | null;
}

export function useMarketingOs(projectId: string | null) {
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [artifacts, setArtifacts] = useState<Record<MarketingOsCommand, MarketingOsArtifact | null>>({
    creatives: null,
    content: null,
    site_brief: null,
    site_build: null,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const sb = supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{ data: unknown }>;
          } & Promise<{ data: unknown }>;
        };
      };
    };
    const [{ data: briefRow }, { data: artRows }] = await Promise.all([
      sb.from("project_briefs").select("*").eq("project_id", projectId).maybeSingle(),
      sb.from("marketing_os_artifacts").select("*").eq("project_id", projectId),
    ]);
    setBrief(briefRow as ProjectBrief | null);
    const next: Record<MarketingOsCommand, MarketingOsArtifact | null> = {
      creatives: null,
      content: null,
      site_brief: null,
      site_build: null,
    };
    for (const row of (artRows as MarketingOsArtifact[] | null) ?? []) {
      next[row.command] = row;
    }
    setArtifacts(next);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useRealtimeTable("marketing_os_artifacts", refresh, !!projectId);
  useRealtimeTable("project_briefs", refresh, !!projectId);

  const runCommand = useCallback(
    async (
      fnName:
        | "generate-project-brief"
        | "marketing-os-creatives"
        | "marketing-os-content"
        | "marketing-os-site-brief"
        | "marketing-os-site-build",
      extra?: Record<string, unknown>,
    ) => {
      if (!projectId) throw new Error("no project");
      const { error } = await supabase.functions.invoke(fnName, {
        body: { projectId, ...extra },
      });
      if (error) throw error;
      await refresh();
    },
    [projectId, refresh],
  );

  return { brief, artifacts, loading, refresh, runCommand };
}
