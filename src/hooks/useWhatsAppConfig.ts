import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import type { WhatsAppConfig } from "@/types/crm";

type GreenStatusResp = {
  data?: { stateInstance?: string };
} | null;

type WaWebSessionRow = {
  status?: string | null;
  phone?: string | null;
  display_name?: string | null;
};

/**
 * CRM WhatsApp connected flag.
 * True if either free WhatsApp Web (QR) is connected for the active project,
 * or Green API / whatsapp_config says authorized.
 *
 * WA Web status is read from `whatsapp_web_sessions` (RLS) first — same source
 * the Settings card uses via bridge, but without depending on edge invoke.
 */
export function useWhatsAppConfig(projectId?: string | null) {
  const { user } = useAuth();
  const [config, setConfig] = useState<WhatsAppConfig>({ connected: false });

  const refetch = useCallback(async () => {
    if (!user?.id) {
      setConfig({ connected: false });
      return;
    }

    // Prefer WA Web session (RLS) — skip Green status round-trip when QR is live.
    const webRowRes = projectId
      ? await supabase
          .from("whatsapp_web_sessions" as never)
          .select("status, phone, display_name")
          .eq("project_id", projectId)
          .maybeSingle()
      : { data: null, error: null };

    const webRow = (webRowRes as { data?: WaWebSessionRow | null } | null)?.data ?? null;
    const webConnected = webRow?.status === "connected";
    const webPhone = webRow?.phone?.trim() || null;
    const webName = webRow?.display_name?.trim() || null;

    if (webConnected) {
      setConfig({
        connected: true,
        phone: webPhone || undefined,
        displayName: webName || undefined,
        connectedAt: new Date().toISOString(),
      });
      return;
    }

    const [configRes, statusRes] = await Promise.all([
      supabase
        .from("whatsapp_config_safe")
        .select("phone, display_name, connected, connected_at")
        .eq("project_id", projectId ?? "")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.functions
        .invoke("greenapi-proxy", { body: { action: "status", project_id: projectId ?? undefined } })
        .catch(() => ({ data: null, error: null })),
    ]);

    const data = configRes.data as {
      phone?: string | null;
      display_name?: string | null;
      connected?: boolean | null;
      connected_at?: string | null;
    } | null;

    const liveState =
      (statusRes as { data?: GreenStatusResp } | null)?.data?.data?.stateInstance
      ?? null;
    const liveConnected = liveState ? liveState === "authorized" : undefined;
    const greenConnected =
      typeof liveConnected === "boolean" ? liveConnected : !!data?.connected;

    const connected = greenConnected;
    setConfig({
      connected,
      phone: data?.phone ?? undefined,
      displayName: data?.display_name ?? undefined,
      connectedAt: connected
        ? (data?.connected_at ?? new Date().toISOString())
        : undefined,
    });

    const shouldSyncRow =
      typeof liveConnected === "boolean"
      && (
        (!!data && !!data.connected !== liveConnected)
        || (!data && liveConnected)
      );

    if (shouldSyncRow) {
      await supabase.from("whatsapp_config").upsert({
        user_id: user.id,
        project_id: projectId,
        connected: liveConnected,
        phone: data?.phone ?? null,
        display_name: data?.display_name ?? null,
        connected_at: liveConnected
          ? (data?.connected_at ?? new Date().toISOString())
          : null,
      });
    }
  }, [user?.id, projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRealtimeTable("whatsapp_config", refetch, !!user?.id);
  useRealtimeTable("whatsapp_web_sessions", refetch, !!user?.id && !!projectId);

  const setWhatsapp = useCallback(async (cfg: WhatsAppConfig) => {
    if (!user?.id) return;
    setConfig(cfg); // optimistic
    await supabase.from("whatsapp_config").upsert({
      user_id: user.id,
      project_id: projectId,
      connected: cfg.connected,
      phone: cfg.phone ?? null,
      display_name: cfg.displayName ?? null,
      connected_at: cfg.connectedAt ?? (cfg.connected ? new Date().toISOString() : null),
    });
  }, [user?.id, projectId]);

  return { config, setWhatsapp, refetch };
}
