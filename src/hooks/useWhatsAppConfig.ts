import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import type { WhatsAppConfig } from "@/types/crm";

export function useWhatsAppConfig() {
  const { user } = useAuth();
  const [config, setConfig] = useState<WhatsAppConfig>({ connected: false });

  const refetch = useCallback(async () => {
    if (!user?.id) { setConfig({ connected: false }); return; }
    const [configRes, statusRes] = await Promise.all([
      supabase
        .from("whatsapp_config_safe")
        .select("phone, display_name, connected, connected_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.functions.invoke("greenapi-proxy", {
        body: { action: "status" },
      }).catch(() => null),
    ]);

    const data = configRes.data;
    const liveState = ((statusRes as { data?: { data?: { stateInstance?: string } } } | null)?.data?.data?.stateInstance) ?? null;
    const liveConnected = liveState ? liveState === "authorized" : undefined;
    const connected = typeof liveConnected === "boolean" ? liveConnected : !!data?.connected;

    setConfig({
      connected,
      phone: data?.phone ?? undefined,
      displayName: data?.display_name ?? undefined,
      connectedAt: connected ? (data?.connected_at ?? new Date().toISOString()) : undefined,
    });

    const shouldSyncRow = typeof liveConnected === "boolean" && (
      (!!data && !!data.connected !== liveConnected) ||
      (!data && liveConnected)
    );

    if (shouldSyncRow) {
      await supabase.from("whatsapp_config").upsert({
        user_id: user.id,
        connected: liveConnected,
        phone: data?.phone ?? null,
        display_name: data?.display_name ?? null,
        connected_at: liveConnected ? (data?.connected_at ?? new Date().toISOString()) : null,
      });
    }
  }, [user?.id]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("whatsapp_config", refetch, !!user?.id);

  const setWhatsapp = useCallback(async (cfg: WhatsAppConfig) => {
    if (!user?.id) return;
    setConfig(cfg); // optimistic
    await supabase.from("whatsapp_config").upsert({
      user_id: user.id,
      connected: cfg.connected,
      phone: cfg.phone ?? null,
      display_name: cfg.displayName ?? null,
      connected_at: cfg.connectedAt ?? (cfg.connected ? new Date().toISOString() : null),
    });
  }, [user?.id]);

  return { config, setWhatsapp };
}
