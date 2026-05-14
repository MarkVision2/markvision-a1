import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import type { WhatsAppConfig } from "@/types/crm";

/**
 * Reads whatsapp_config for the active project. The greenapi-proxy edge
 * function syncs `connected/phone` back to this row after every status
 * call, and the webhook does the same on stateInstanceChanged — so we
 * just project the row and rely on realtime for fresh data.
 */
export function useWhatsAppConfig() {
  const { user } = useAuth();
  const { active } = useProjectsStore();
  const projectId = active?.id ?? null;
  const [config, setConfig] = useState<WhatsAppConfig>({ connected: false });

  const refetch = useCallback(async () => {
    if (!user?.id || !projectId) {
      setConfig({ connected: false });
      return;
    }
    // Cast: generated types are pre-per-project — they're missing the
    // `project_id`, `id_instance`, `api_token`, `api_url` columns.
    const { data } = await (supabase as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: {
              connected?: boolean;
              phone?: string | null;
              display_name?: string | null;
              connected_at?: string | null;
            } | null }>;
          };
        };
      };
    })
      .from("whatsapp_config")
      .select("connected, phone, display_name, connected_at")
      .eq("project_id", projectId)
      .maybeSingle();

    setConfig({
      connected: !!data?.connected,
      phone: data?.phone ?? undefined,
      displayName: data?.display_name ?? undefined,
      connectedAt: data?.connected_at ?? undefined,
    });
  }, [user?.id, projectId]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("whatsapp_config", refetch, !!user?.id);

  // Optimistic local override — the actual row is owned by the edge
  // functions, but UI flows (e.g. ConnectWhatsAppDialog) want to flip
  // the badge before the next refetch.
  const setWhatsapp = useCallback((cfg: WhatsAppConfig) => {
    setConfig(cfg);
  }, []);

  return { config, setWhatsapp };
}
