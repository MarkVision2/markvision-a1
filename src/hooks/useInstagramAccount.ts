import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export interface InstagramAccount {
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  pageId: string | null;
  pageName: string | null;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
  active: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  igLoginTokenPresent: boolean;
  pageTokenPresent: boolean;
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

function describeErr(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; error?: unknown; details?: unknown };
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    if (typeof o.error === "string" && o.error.trim()) return o.error;
    if (typeof o.details === "string" && o.details.trim()) return o.details;
  }
  return fallback;
}

export function useInstagramAccount() {
  const { activeId: projectId } = useProjectsStore();
  const [account, setAccount] = useState<InstagramAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setAccount(null);
      setLoadError(null);
      return;
    }
    const { data, error } = await supabase
      .from("instagram_accounts_safe")
      .select(
        "ig_user_id, username, name, profile_picture_url, page_id, page_name, followers_count, follows_count, media_count, active, last_sync_at, last_error, ig_login_token_present, page_token_present",
      )
      .eq("project_id", projectId)
      .maybeSingle();

    if (error) {
      // Older view without ig_login_token_present — retry without that column.
      if (/ig_login_token_present|column/i.test(error.message)) {
        const legacy = await supabase
          .from("instagram_accounts_safe")
          .select(
            "ig_user_id, username, name, profile_picture_url, page_id, page_name, followers_count, follows_count, media_count, active, last_sync_at, last_error, page_token_present",
          )
          .eq("project_id", projectId)
          .maybeSingle();
        if (legacy.error) {
          setLoadError(legacy.error.message);
          setAccount(null);
          return;
        }
        if (!legacy.data) {
          setAccount(null);
          setLoadError(null);
          return;
        }
        const row = legacy.data as Record<string, unknown>;
        setAccount({
          igUserId: String(row.ig_user_id),
          username: (row.username as string | null) ?? null,
          name: (row.name as string | null) ?? null,
          profilePictureUrl: (row.profile_picture_url as string | null) ?? null,
          pageId: (row.page_id as string | null) ?? null,
          pageName: (row.page_name as string | null) ?? null,
          followersCount: Number(row.followers_count ?? 0),
          followsCount: Number(row.follows_count ?? 0),
          mediaCount: Number(row.media_count ?? 0),
          active: !!row.active,
          lastSyncAt: (row.last_sync_at as string | null) ?? null,
          lastError: (row.last_error as string | null) ?? null,
          igLoginTokenPresent: false,
          pageTokenPresent: !!row.page_token_present,
        });
        setLoadError(null);
        return;
      }
      setLoadError(error.message);
      setAccount(null);
      return;
    }

    if (!data) {
      setAccount(null);
      setLoadError(null);
      return;
    }
    const row = data as unknown as Record<string, unknown>;
    setAccount({
      igUserId: String(row.ig_user_id),
      username: (row.username as string | null) ?? null,
      name: (row.name as string | null) ?? null,
      profilePictureUrl: (row.profile_picture_url as string | null) ?? null,
      pageId: (row.page_id as string | null) ?? null,
      pageName: (row.page_name as string | null) ?? null,
      followersCount: Number(row.followers_count ?? 0),
      followsCount: Number(row.follows_count ?? 0),
      mediaCount: Number(row.media_count ?? 0),
      active: !!row.active,
      lastSyncAt: (row.last_sync_at as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null,
      igLoginTokenPresent: !!row.ig_login_token_present,
      pageTokenPresent: !!row.page_token_present,
    });
    setLoadError(null);
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRealtimeTable("instagram_accounts", refetch, !!projectId, 800);

  const listAvailable = useCallback(async (metaToken?: string): Promise<{ accounts: AvailableIgAccount[]; error?: string }> => {
    if (!projectId) return { accounts: [], error: "no project" };
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-list-accounts", {
        body: {
          project_id: projectId,
          ...(metaToken?.trim() ? { meta_token: metaToken.trim() } : {}),
        },
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

  const connect = useCallback(async (selected: AvailableIgAccount, metaToken?: string) => {
    if (!projectId) throw new Error("no project");
    const { data, error } = await supabase.functions.invoke("instagram-connect", {
      body: {
        project_id: projectId,
        page_id: selected.page_id,
        ig_user_id: selected.ig_user_id,
        ...(metaToken?.trim() ? { meta_token: metaToken.trim() } : {}),
      },
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
      const { data, error } = await supabase.functions.invoke("instagram-sync", { body: { project_id: projectId } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      await refetch();
      return data as {
        ok?: boolean;
        results?: Array<{ webhook?: { attempted?: boolean; ok?: boolean; error?: string } }>;
      };
    } finally {
      setLoading(false);
    }
  }, [projectId, refetch]);

  /** Connect or refresh account via Instagram Login token (no Facebook Page required). */
  const connectWithLoginToken = useCallback(async (token: string) => {
    if (!projectId) throw new Error("no project");
    const { data, error } = await supabase.functions.invoke("instagram-set-login-token", {
      body: { project_id: projectId, token, connect: true },
    });
    if (error) throw new Error(describeErr(error, error.message || "Не удалось подключить"));
    if (data?.error) throw new Error(String(data.error));
    await refetch();
    return { username: (data?.username as string | null) ?? null };
  }, [projectId, refetch]);

  /** Legacy: only set DM token on already-connected account. */
  const setLoginToken = useCallback(async (token: string) => {
    if (!projectId) throw new Error("no project");
    const { data, error } = await supabase.functions.invoke("instagram-set-login-token", {
      body: { project_id: projectId, token, connect: false },
    });
    if (error) throw new Error(describeErr(error, error.message || "Не удалось сохранить токен"));
    if (data?.error) throw new Error(String(data.error));
    await refetch();
  }, [projectId, refetch]);

  return {
    account,
    loading,
    loadError,
    listAvailable,
    connect,
    connectWithLoginToken,
    disconnect,
    sync,
    setLoginToken,
    refetch,
  };
}
