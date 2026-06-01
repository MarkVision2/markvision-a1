import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export type IgAccountStatus = "pending" | "connected" | "error" | "expired" | "disconnected";

export interface InstagramAccount {
  id: string;
  projectId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  igUserId: string | null;
  igBusinessId: string | null;
  pageId: string | null;
  tokenExpiresAt: string | null;
  status: IgAccountStatus;
  lastError: string | null;
  connectedAt: string | null;
  lastEventAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface RawRow {
  id: string;
  project_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  ig_user_id: string | null;
  ig_business_id: string | null;
  page_id: string | null;
  token_expires_at: string | null;
  status: IgAccountStatus;
  last_error: string | null;
  connected_at: string | null;
  last_event_at: string | null;
  notes: string | null;
  created_at: string;
}

const toAcc = (r: RawRow): InstagramAccount => ({
  id: r.id,
  projectId: r.project_id,
  handle: r.handle,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  igUserId: r.ig_user_id,
  igBusinessId: r.ig_business_id,
  pageId: r.page_id,
  tokenExpiresAt: r.token_expires_at,
  status: r.status,
  lastError: r.last_error,
  connectedAt: r.connected_at,
  lastEventAt: r.last_event_at,
  notes: r.notes,
  createdAt: r.created_at,
});

export function useInstagramAccounts() {
  const { activeId: projectId } = useProjectsStore();
  const [items, setItems] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useRealtimeTable("project_instagram_accounts", () => setTick((t) => t + 1), true, 600);

  useEffect(() => {
    if (!projectId) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("project_instagram_accounts")
        .select(
          "id, project_id, handle, display_name, avatar_url, ig_user_id, ig_business_id, page_id, token_expires_at, status, last_error, connected_at, last_event_at, notes, created_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setItems((data ?? []).map((r) => toAcc(r as RawRow)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, tick]);

  const add = async (input: {
    handle: string;
    displayName?: string | null;
    notes?: string | null;
  }) => {
    if (!projectId) throw new Error("Сначала выберите проект");
    const handle = input.handle.trim().replace(/^@/, "").toLowerCase();
    if (!handle) throw new Error("Введите @username");
    const { error } = await supabase.from("project_instagram_accounts").insert({
      project_id: projectId,
      handle,
      display_name: input.displayName ?? null,
      notes: input.notes ?? null,
      status: "pending",
    });
    if (error) throw error;
  };

  const update = async (id: string, patch: Partial<{
    displayName: string | null;
    avatarUrl: string | null;
    notes: string | null;
    status: IgAccountStatus;
  }>) => {
    const payload: Record<string, unknown> = {};
    if (patch.displayName !== undefined) payload.display_name = patch.displayName;
    if (patch.avatarUrl !== undefined) payload.avatar_url = patch.avatarUrl;
    if (patch.notes !== undefined) payload.notes = patch.notes;
    if (patch.status !== undefined) payload.status = patch.status;
    if (Object.keys(payload).length === 0) return;
    const { error } = await supabase
      .from("project_instagram_accounts")
      .update(payload as never)
      .eq("id", id);
    if (error) throw error;
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("project_instagram_accounts").delete().eq("id", id);
    if (error) throw error;
  };

  return { items, loading, add, update, remove };
}
