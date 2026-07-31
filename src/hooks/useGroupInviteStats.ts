import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface GroupInviteLinkStat {
  id: string;
  slug: string;
  label: string;
  inviteUrl: string;
  groupId: string | null;
  clickCount: number;
  joinCount: number;
  baselineTaken: boolean;
  trackingStartedAt: string;
}

export interface GroupInviteJoinRow {
  phoneDigits: string;
  firstSeenAt: string;
  leadId: string | null;
  leadName: string | null;
}

export interface GroupInviteClickDay {
  date: string;
  clicks: number;
}

const TRACKED_BASE = "https://www.markvision.kz/g/";

export function trackedInviteUrl(slug: string, utmSource?: string): string {
  const u = `${TRACKED_BASE}${slug}`;
  if (!utmSource?.trim()) return u;
  return `${u}?utm_source=${encodeURIComponent(utmSource.trim())}`;
}

async function fetchLinks(projectId: string): Promise<GroupInviteLinkStat[]> {
  const { data, error } = await supabase
    .from("group_invite_links" as never)
    .select(
      "id,slug,label,invite_url,group_id,click_count,join_count,baseline_taken,tracking_started_at",
    )
    .eq("project_id", projectId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    label: String(r.label ?? ""),
    inviteUrl: String(r.invite_url ?? ""),
    groupId: (r.group_id as string | null) ?? null,
    clickCount: Number(r.click_count) || 0,
    joinCount: Number(r.join_count) || 0,
    baselineTaken: Boolean(r.baseline_taken),
    trackingStartedAt: String(r.tracking_started_at ?? ""),
  }));
}

async function fetchJoins(linkId: string): Promise<GroupInviteJoinRow[]> {
  const { data, error } = await supabase
    .from("group_invite_members" as never)
    .select("phone_digits,first_seen_at,lead_id")
    .eq("link_id", linkId)
    .eq("joined_via_link", true)
    .order("first_seen_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    phone_digits: string;
    first_seen_at: string;
    lead_id: string | null;
  }>;
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from("leads")
      .select("id,name")
      .in("id", leadIds);
    for (const l of (leads ?? []) as Array<{ id: string; name: string | null }>) {
      nameById.set(l.id, (l.name ?? "").trim() || "Без имени");
    }
  }
  return rows.map((r) => ({
    phoneDigits: r.phone_digits,
    firstSeenAt: r.first_seen_at,
    leadId: r.lead_id,
    leadName: r.lead_id ? (nameById.get(r.lead_id) ?? null) : null,
  }));
}

async function fetchClickDays(linkId: string): Promise<GroupInviteClickDay[]> {
  const { data, error } = await supabase
    .from("group_invite_clicks" as never)
    .select("date")
    .eq("link_id", linkId)
    .order("date", { ascending: false })
    .limit(2000);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ date: string }>) {
    map.set(r.date, (map.get(r.date) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([date, clicks]) => ({ date, clicks }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);
}

export function useGroupInviteStats() {
  const { activeId } = useProjectsStore();
  const [links, setLinks] = useState<GroupInviteLinkStat[]>([]);
  const [joinsByLink, setJoinsByLink] = useState<Record<string, GroupInviteJoinRow[]>>({});
  const [clicksByLink, setClicksByLink] = useState<Record<string, GroupInviteClickDay[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!activeId) {
      setLinks([]);
      setJoinsByLink({});
      setClicksByLink({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await fetchLinks(activeId);
      setLinks(list);
      const joins: Record<string, GroupInviteJoinRow[]> = {};
      const clicks: Record<string, GroupInviteClickDay[]> = {};
      await Promise.all(
        list.map(async (l) => {
          joins[l.id] = await fetchJoins(l.id);
          clicks[l.id] = await fetchClickDays(l.id);
        }),
      );
      setJoinsByLink(joins);
      setClicksByLink(clicks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { links, joinsByLink, clicksByLink, loading, error, refetch };
}
