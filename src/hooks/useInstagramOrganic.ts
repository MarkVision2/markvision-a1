import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { normalizeVariantList } from "@/lib/codewordVariants";

function genClientShortId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}

function isShortIdGeneratorBroken(message: string): boolean {
  return /gen_random_bytes|gen_codeword_short_id|short_id/i.test(message);
}

export interface InstagramOrganicEvent {
  id: string;
  projectId: string | null;
  codewordId: string | null;
  codeword: string | null;
  reelId: string | null;
  reelUrl: string | null;
  eventType: "codeword_dm" | "link_click" | "lead";
  username: string | null;
  contact: string | null;
  leadId: string | null;
  date: string;
  occurredAt: string;
}

export interface InstagramOrganicFunnelData {
  codewordDms: number;
  uniqueUsers: number;
  linkClicks: number;
  leads: number;
}

export interface CodewordStat {
  codewordId: string;
  codeword: string;
  shortId: string | null;
  reelUrl: string | null;
  thumbnailUrl: string | null;
  active: boolean;
  codewordDms: number;
  codewordComments?: number;
  uniqueUsers?: number;
  linkClicks: number;
  leads: number;
  sales: number;
  revenue: number;
  lastEventAt: string | null;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface RawEvent {
  id: string;
  project_id: string | null;
  codeword_id: string | null;
  codeword: string | null;
  reel_id: string | null;
  reel_url: string | null;
  event_type: "codeword_dm" | "link_click" | "lead";
  username: string | null;
  contact: string | null;
  lead_id: string | null;
  date: string;
  occurred_at: string;
}

const toEvent = (r: RawEvent): InstagramOrganicEvent => ({
  id: r.id,
  projectId: r.project_id,
  codewordId: r.codeword_id,
  codeword: r.codeword,
  reelId: r.reel_id,
  reelUrl: r.reel_url,
  eventType: r.event_type,
  username: r.username,
  contact: r.contact,
  leadId: r.lead_id,
  date: r.date,
  occurredAt: r.occurred_at,
});

export function useInstagramOrganic(range: { from: Date; to: Date }) {
  const { activeId: projectId } = useProjectsStore();
  const [events, setEvents] = useState<InstagramOrganicEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useRealtimeTable("instagram_organic_events", () => setTick((t) => t + 1), true, 800);

  const since = useMemo(() => ymd(range.from), [range.from]);
  const until = useMemo(() => ymd(range.to), [range.to]);

  useEffect(() => {
    if (!projectId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error: err } = await supabase
        .from("instagram_organic_events")
        .select("id, project_id, codeword_id, codeword, reel_id, reel_url, event_type, username, contact, lead_id, date, occurred_at")
        .eq("project_id", projectId)
        .gte("date", since)
        .lte("date", until)
        .order("occurred_at", { ascending: false })
        .limit(2000);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setEvents([]);
      } else {
        setEvents((data ?? []).map((r) => toEvent(r as RawEvent)));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, since, until, tick]);

  const funnel = useMemo<InstagramOrganicFunnelData>(() => {
    const dms = events.filter((e) => e.eventType === "codeword_dm");
    const clicks = events.filter((e) => e.eventType === "link_click");
    const leads = events.filter((e) => e.eventType === "lead");
    const uniqueUsers = new Set(dms.map((e) => e.username || e.contact || e.id)).size;
    return {
      codewordDms: dms.length,
      uniqueUsers,
      linkClicks: clicks.length,
      leads: leads.length,
    };
  }, [events]);

  return { events, funnel, loading, error };
}

export function useCodewordStats() {
  const { activeId: projectId } = useProjectsStore();
  const [stats, setStats] = useState<CodewordStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useRealtimeTable("instagram_organic_events", () => setTick((t) => t + 1), true, 1500);
  useRealtimeTable("instagram_codewords", () => setTick((t) => t + 1), true, 800);

  useEffect(() => {
    if (!projectId) {
      setStats([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("instagram_codeword_stats")
        .select("codeword_id, codeword, short_id, reel_url, thumbnail_url, active, codeword_dms, codeword_comments, unique_users, link_clicks, leads, sales, revenue, last_event_at")
        .eq("project_id", projectId);
      if (cancelled) return;
      if (error) {
        setStats([]);
      } else {
        setStats(
          ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
            codewordId: String(r.codeword_id),
            codeword: String(r.codeword ?? ""),
            shortId: (r.short_id as string | null) ?? null,
            reelUrl: (r.reel_url as string | null) ?? null,
            thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
            active: !!r.active,
            codewordDms: Number(r.codeword_dms ?? 0),
            codewordComments: Number(r.codeword_comments ?? 0),
            uniqueUsers: Number(r.unique_users ?? 0),
            linkClicks: Number(r.link_clicks ?? 0),
            leads: Number(r.leads ?? 0),
            sales: Number(r.sales ?? 0),
            revenue: Number(r.revenue ?? 0),
            lastEventAt: (r.last_event_at as string | null) ?? null,
          })),
        );
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, tick]);

  return { stats, loading };
}

export interface InstagramCodeword {
  id: string;
  projectId: string;
  codeword: string;
  shortId?: string | null;
  reelId: string | null;
  reelUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  publishedAt: string | null;
  targetUrl: string | null;
  commentReplies: string[];
  dmMessages: string[];
  targetUrls: string[];
  dmButtonTitle: string | null;
  active: boolean;
}

const isMissingDmButtonColumn = (message: string | undefined | null) =>
  !!message &&
  /dm_button_title/i.test(message) &&
  /column|schema cache|schema|PGRST204|does not exist/i.test(message);

/** null = unknown; false after PostgREST says column missing on prod. */
let dmButtonTitleColumnOk: boolean | null = null;

async function canWriteDmButtonTitle(): Promise<boolean> {
  if (dmButtonTitleColumnOk != null) return dmButtonTitleColumnOk;
  const { error } = await supabase.from("instagram_codewords").select("dm_button_title").limit(1);
  if (error) {
    // Missing column → skip field. Other errors → also skip to avoid blocking saves.
    dmButtonTitleColumnOk = false;
    return false;
  }
  dmButtonTitleColumnOk = true;
  return true;
}

export function useInstagramCodewords() {
  const { activeId: projectId } = useProjectsStore();
  const [items, setItems] = useState<InstagramCodeword[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useRealtimeTable("instagram_codewords", () => setTick((t) => t + 1), true, 400);

  useEffect(() => {
    if (!projectId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("instagram_codewords")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setItems(
        (data ?? []).map((r: Record<string, unknown>) => {
          const targetUrls = normalizeVariantList(r.target_urls as string[] | null);
          const legacyTarget = (r.target_url as string | null) ?? null;
          return {
            id: String(r.id),
            projectId: String(r.project_id),
            codeword: String(r.codeword ?? ""),
            shortId: (r.short_id as string | null) ?? null,
            reelId: (r.reel_id as string | null) ?? null,
            reelUrl: (r.reel_url as string | null) ?? null,
            thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
            caption: (r.caption as string | null) ?? null,
            publishedAt: (r.published_at as string | null) ?? null,
            targetUrl: legacyTarget ?? targetUrls[0] ?? null,
            commentReplies: normalizeVariantList(r.comment_replies as string[] | null),
            dmMessages: normalizeVariantList(r.dm_messages as string[] | null),
            targetUrls: targetUrls.length > 0 ? targetUrls : legacyTarget ? [legacyTarget] : [],
            dmButtonTitle: (r.dm_button_title as string | null) ?? null,
            active: !!r.active,
          };
        }),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, tick]);

  const add = async (input: Omit<InstagramCodeword, "id" | "projectId">) => {
    if (!projectId) throw new Error("Сначала выберите проект");
    const targetUrls = normalizeVariantList(input.targetUrls);
    const writeBtn = await canWriteDmButtonTitle();
    const base: Record<string, unknown> = {
      project_id: projectId,
      codeword: input.codeword.trim().toLowerCase(),
      reel_id: input.reelId,
      reel_url: input.reelUrl,
      thumbnail_url: input.thumbnailUrl,
      caption: input.caption,
      published_at: input.publishedAt,
      target_url: targetUrls[0] ?? input.targetUrl,
      comment_replies: normalizeVariantList(input.commentReplies),
      dm_messages: normalizeVariantList(input.dmMessages),
      target_urls: targetUrls,
      active: input.active,
      short_id: genClientShortId(),
    };
    if (writeBtn) base.dm_button_title = input.dmButtonTitle?.trim() || null;
    let { error } = await supabase.from("instagram_codewords").insert(base as never);
    // If short_id column somehow absent on older DBs, retry without it.
    if (error && /short_id/i.test(error.message) && /column|schema|does not exist/i.test(error.message)) {
      const { short_id: _drop, ...withoutShort } = base;
      const retry = await supabase.from("instagram_codewords").insert(withoutShort as never);
      error = retry.error;
    }
    if (error && isMissingDmButtonColumn(error.message)) {
      dmButtonTitleColumnOk = false;
      const { dm_button_title: _drop, ...withoutBtn } = base;
      const retry = await supabase.from("instagram_codewords").insert(withoutBtn as never);
      error = retry.error;
    }
    // Legacy DEFAULT may still fire on empty short_id — retry once with another id if unique collision.
    if (error && isShortIdGeneratorBroken(error.message)) {
      const retryPayload: Record<string, unknown> = { ...base, short_id: genClientShortId() };
      if (!writeBtn || dmButtonTitleColumnOk === false) delete retryPayload.dm_button_title;
      const retry = await supabase.from("instagram_codewords").insert(retryPayload as never);
      error = retry.error;
      if (error && isMissingDmButtonColumn(error.message)) {
        dmButtonTitleColumnOk = false;
        const { dm_button_title: _drop, ...withoutBtn } = retryPayload;
        const retry2 = await supabase.from("instagram_codewords").insert(withoutBtn as never);
        error = retry2.error;
      }
    }
    if (error) throw new Error(error.message || "Не удалось добавить код-слово");
  };

  const update = async (id: string, patch: Partial<InstagramCodeword>) => {
    const payload: Record<string, unknown> = {};
    if (patch.codeword !== undefined) payload.codeword = patch.codeword.trim().toLowerCase();
    if (patch.reelId !== undefined) payload.reel_id = patch.reelId;
    if (patch.reelUrl !== undefined) payload.reel_url = patch.reelUrl;
    if (patch.thumbnailUrl !== undefined) payload.thumbnail_url = patch.thumbnailUrl;
    if (patch.caption !== undefined) payload.caption = patch.caption;
    if (patch.publishedAt !== undefined) payload.published_at = patch.publishedAt;
    if (patch.commentReplies !== undefined) payload.comment_replies = normalizeVariantList(patch.commentReplies);
    if (patch.dmMessages !== undefined) payload.dm_messages = normalizeVariantList(patch.dmMessages);
    if (patch.dmButtonTitle !== undefined && (await canWriteDmButtonTitle())) {
      payload.dm_button_title = patch.dmButtonTitle?.trim() || null;
    }
    if (patch.targetUrls !== undefined) {
      const urls = normalizeVariantList(patch.targetUrls);
      payload.target_urls = urls;
      payload.target_url = urls[0] ?? null;
    } else if (patch.targetUrl !== undefined) {
      payload.target_url = patch.targetUrl;
    }
    if (patch.active !== undefined) payload.active = patch.active;
    let { error } = await supabase.from("instagram_codewords").update(payload as never).eq("id", id);
    if (error && payload.dm_button_title !== undefined && isMissingDmButtonColumn(error.message)) {
      dmButtonTitleColumnOk = false;
      const { dm_button_title: _drop, ...withoutBtn } = payload;
      const retry = await supabase.from("instagram_codewords").update(withoutBtn as never).eq("id", id);
      error = retry.error;
    }
    if (error) throw new Error(error.message || "Не удалось сохранить код-слово");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("instagram_codewords").delete().eq("id", id);
    if (error) throw new Error(error.message || "Не удалось удалить код-слово");
  };

  return { items, loading, add, update, remove };
}

export interface CodewordLeadRow {
  leadId: string;
  name: string;
  phone: string;
  paid: boolean;
  amount: number;
  occurredAt: string;
}

export function useCodewordLeads(codewordId: string | null) {
  const [rows, setRows] = useState<CodewordLeadRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!codewordId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("instagram_organic_events")
        .select("lead_id, occurred_at, leads:lead_id (id, name, phone, paid, amount)")
        .eq("codeword_id", codewordId)
        .eq("event_type", "lead")
        .not("lead_id", "is", null)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (error) {
        setRows([]);
      } else {
        setRows(
          (data ?? [])
            .map((r: Record<string, unknown>) => {
              const lead = r.leads as Record<string, unknown> | null;
              if (!lead?.id) return null;
              return {
                leadId: String(lead.id),
                name: String(lead.name ?? ""),
                phone: String(lead.phone ?? ""),
                paid: !!lead.paid,
                amount: Number(lead.amount ?? 0),
                occurredAt: String(r.occurred_at ?? ""),
              };
            })
            .filter((x): x is CodewordLeadRow => x !== null),
        );
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [codewordId]);

  return { rows, loading };
}
