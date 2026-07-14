import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export interface InstagramAccount {
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  pageId: string;
  pageName: string | null;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
  active: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  igLoginTokenPresent: boolean;
}

export interface AvailableIgAccount {
  ig_user_id: string;
  username: string;
  name: string | null;
  profile_picture_url: string | null;
  followers_count: number;
  media_count: number;
  page_id: string;
  page_name: string;
}

export function useInstagramAccount() {
  const { activeId: projectId } = useProjectsStore();
  const [account, setAccount] = useState<InstagramAccount | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setAccount(null);
      return;
    }
    const { data } = await supabase
      .from("instagram_accounts_safe")
      .select("ig_user_id, username, name, profile_picture_url, page_id, page_name, followers_count, follows_count, media_count, active, last_sync_at, last_error, ig_login_token_present")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!data || (data as any).error === true) {
      setAccount(null);
      return;
    }
    const row = data as any;
    setAccount({
      igUserId: row.ig_user_id,
      username: data.username,
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
      pageId: data.page_id,
      pageName: data.page_name,
      followersCount: data.followers_count ?? 0,
      followsCount: data.follows_count ?? 0,
      mediaCount: data.media_count ?? 0,
      active: data.active,
      lastSyncAt: data.last_sync_at,
      lastError: data.last_error,
      igLoginTokenPresent: !!data.ig_login_token_present,
    });
  }, [projectId]);

  useEffect(() => { void refetch(); }, [refetch]);
  useRealtimeTable("instagram_accounts", refetch, !!projectId, 800);

  const listAvailable = useCallback(async (): Promise<{ accounts: AvailableIgAccount[]; error?: string }> => {
    if (!projectId) return { accounts: [], error: "no project" };
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-list-accounts", {
        body: { project_id: projectId },
      });
      if (error) {
        let message = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) message = String(body.error);
          }
        } catch {
          /* ignore */
        }
        if (/failed to send a request/i.test(message)) {
          message =
            "Edge Function недоступна. Обновите страницу и повторите. Если ошибка останется — функция instagram-list-accounts не отвечает.";
        }
        return { accounts: [], error: message };
      }
      return { accounts: data?.accounts ?? [], error: data?.error };
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const connect = useCallback(async (selected: AvailableIgAccount) => {
    if (!projectId) throw new Error("no project");
    const { data, error } = await supabase.functions.invoke("instagram-connect", {
      body: { project_id: projectId, page_id: selected.page_id, ig_user_id: selected.ig_user_id },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    await refetch();
    return { webhookSubscribed: data?.webhookSubscribed !== false, webhookError: data?.webhookError ?? null };
  }, [projectId, refetch]);

  const disconnect = useCallback(async () => {
    if (!projectId) return;
    await supabase.functions.invoke("instagram-disconnect", { body: { project_id: projectId } });
    await refetch();
  }, [projectId, refetch]);

  const sync = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      await supabase.functions.invoke("instagram-sync", { body: { project_id: projectId } });
      await refetch();
    } finally {
      setLoading(false);
    }
  }, [projectId, refetch]);

  const setLoginToken = useCallback(async (token: string) => {
    if (!projectId) throw new Error("no project");
    const { data, error } = await supabase.functions.invoke("instagram-set-login-token", {
      body: { project_id: projectId, token },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    await refetch();
  }, [projectId, refetch]);

  return { account, loading, listAvailable, connect, disconnect, sync, setLoginToken, refetch };
}
