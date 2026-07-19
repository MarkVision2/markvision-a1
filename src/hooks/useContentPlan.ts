import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import {
  type ContentPlanCategory,
  type ContentPlanFunnel,
  type ContentPlanItem,
  type ContentPlanStatus,
  type ContentPlanType,
  summarizeContentPlan,
} from "@/lib/contentPlan";
import {
  buildContentPlanFunnel,
  draftFromIgMedia,
  mediaNotLinkedToPlan,
  resolveIgMediaIdForPlan,
  type ContentPlanIgMedia,
  type ContentPlanOrganicEvent,
} from "@/lib/contentPlanIgLink";

type DbRow = {
  id: string;
  project_id: string;
  title: string;
  category: string;
  content_type: string;
  status: string;
  description: string | null;
  hashtags: string | null;
  prompts: string | null;
  comments_notes: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  child_urls: unknown;
  scheduled_at: string | null;
  published_at: string | null;
  post_instagram: boolean;
  post_facebook: boolean;
  post_threads: boolean;
  post_telegram: boolean;
  post_linkedin: boolean;
  autopost_id: string | null;
  ig_media_id: string | null;
  codeword_id: string | null;
  codeword: string | null;
  utm_content: string | null;
  ad_spend: number | null;
  ai_analysis: string | null;
  created_at: string;
  updated_at: string;
};

type CodewordStatRow = {
  codeword_id: string;
  codeword: string;
  short_id: string | null;
  reel_url: string | null;
  thumbnail_url: string | null;
  active: boolean;
  codeword_dms: number;
  codeword_comments: number;
  unique_users: number;
  link_clicks: number;
  leads: number;
  sales: number;
  revenue: number;
};

type IgMediaRow = ContentPlanIgMedia;

type LeadLite = {
  id: string;
  stage_role: string | null;
  paid: boolean | null;
  amount: number | null;
  deposit_amount: number | null;
  webinar_status: string | null;
  utm: { content?: string | null; campaign?: string | null } | null;
  source: string | null;
};

type CodewordRow = { id: string; codeword: string; reel_id: string | null };

type AutopostLite = { id: string; published_ig_media_id: string | null };

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x)).filter(Boolean);
}

function fromDb(row: DbRow, funnel: ContentPlanFunnel): ContentPlanItem {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title || "Без названия",
    category: (row.category as ContentPlanCategory) || "content",
    contentType: (row.content_type as ContentPlanType) || "REELS",
    status: (row.status as ContentPlanStatus) || "idea",
    description: row.description,
    hashtags: row.hashtags,
    prompts: row.prompts,
    commentsNotes: row.comments_notes,
    mediaUrl: row.media_url,
    thumbnailUrl: row.thumbnail_url,
    childUrls: asStringArray(row.child_urls),
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    platforms: {
      instagram: !!row.post_instagram,
      facebook: !!row.post_facebook,
      threads: !!row.post_threads,
      telegram: !!row.post_telegram,
      linkedin: !!row.post_linkedin,
    },
    autopostId: row.autopost_id,
    igMediaId: row.ig_media_id,
    codewordId: row.codeword_id,
    codeword: row.codeword,
    utmContent: row.utm_content,
    adSpend: Number(row.ad_spend ?? 0),
    aiAnalysis: row.ai_analysis,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    funnel,
    source: "plan",
  };
}

export type ContentPlanDraft = {
  title: string;
  category: ContentPlanCategory;
  contentType: ContentPlanType;
  status: ContentPlanStatus;
  description?: string | null;
  hashtags?: string | null;
  prompts?: string | null;
  commentsNotes?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  scheduledAt?: string | null;
  codewordId?: string | null;
  codeword?: string | null;
  platforms?: Partial<ContentPlanItem["platforms"]>;
  adSpend?: number;
};

export function useContentPlan() {
  const { activeId: projectId } = useProjectsStore();
  const [items, setItems] = useState<ContentPlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tableMissing, setTableMissing] = useState(false);

  useRealtimeTable("content_plan_items", () => setTick((t) => t + 1), !!projectId, 800);
  useRealtimeTable("instagram_organic_events", () => setTick((t) => t + 1), !!projectId, 1500);
  useRealtimeTable("instagram_codewords", () => setTick((t) => t + 1), !!projectId, 1200);
  useRealtimeTable("instagram_media", () => setTick((t) => t + 1), !!projectId, 2000);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [planRes, statsRes, mediaRes, leadsRes, stagesRes, eventsRes, codewordsRes, autopostRes] =
        await Promise.all([
          supabase
            .from("content_plan_items" as never)
            .select("*")
            .eq("project_id", projectId)
            .order("scheduled_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false }),
          supabase
            .from("instagram_codeword_stats")
            .select(
              "codeword_id, codeword, short_id, reel_url, thumbnail_url, active, codeword_dms, codeword_comments, unique_users, link_clicks, leads, sales, revenue",
            )
            .eq("project_id", projectId),
          supabase
            .from("instagram_media")
            .select(
              "media_id, caption, media_type, media_product_type, permalink, thumbnail_url, media_url, timestamp, like_count, comments_count, shares_count, saved_count, reach, impressions, video_views, plays",
            )
            .eq("project_id", projectId)
            .order("timestamp", { ascending: false })
            .limit(200),
          supabase
            .from("leads")
            .select("id, paid, amount, deposit_amount, utm, source, stage_id, webinar_status")
            .eq("project_id", projectId)
            .eq("is_personal", false)
            .limit(5000),
          supabase.from("pipeline_stages").select("id, key, stage_role"),
          supabase
            .from("instagram_organic_events")
            .select("id, codeword_id, codeword, event_type, lead_id, reel_id, payload")
            .eq("project_id", projectId)
            .limit(8000),
          supabase
            .from("instagram_codewords")
            .select("id, codeword, reel_id")
            .eq("project_id", projectId)
            .eq("active", true),
          supabase
            .from("cf_scheduled_posts")
            .select("id, published_ig_media_id")
            .eq("project_id", projectId)
            .not("published_ig_media_id", "is", null)
            .limit(500),
        ]);

      let missingTable = false;
      if (planRes.error) {
        if (/relation .*content_plan_items.* does not exist|Could not find the table/i.test(planRes.error.message)) {
          missingTable = true;
          setTableMissing(true);
        } else {
          setError(planRes.error.message);
        }
      } else {
        setTableMissing(false);
      }

      const stats = (statsRes.data ?? []) as unknown as CodewordStatRow[];
      const media = (mediaRes.data ?? []) as unknown as IgMediaRow[];
      const codewords = (!codewordsRes.error ? codewordsRes.data ?? [] : []) as unknown as CodewordRow[];
      const autoposts = (!autopostRes.error ? autopostRes.data ?? [] : []) as unknown as AutopostLite[];
      const events = (eventsRes.data ?? []) as unknown as ContentPlanOrganicEvent[];

      const stageRoleById = new Map<string, string>();
      for (const s of stagesRes.data ?? []) {
        const role = (s as { stage_role?: string }).stage_role;
        if (role) stageRoleById.set(s.id, role);
      }

      const leads: LeadLite[] = ((leadsRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        stage_role: stageRoleById.get(String(r.stage_id ?? "")) ?? null,
        paid: r.paid as boolean | null,
        amount: Number(r.amount ?? 0),
        deposit_amount: Number(r.deposit_amount ?? 0),
        webinar_status: (r.webinar_status as string | null) ?? null,
        utm: (r.utm as LeadLite["utm"]) ?? null,
        source: (r.source as string | null) ?? null,
      }));

      const statsByCodewordId = new Map(stats.map((s) => [s.codeword_id, s]));
      const mediaById = new Map(media.map((m) => [m.media_id, m]));
      const publishedByAutopost = new Map(
        autoposts
          .filter((p) => p.published_ig_media_id)
          .map((p) => [String(p.id), String(p.published_ig_media_id)]),
      );

      let planDbRows = ((planRes.data ?? []) as unknown as DbRow[]) ?? [];

      // 1) Привязать существующие строки плана к IG media (автопост / caption).
      if (!planRes.error) {
        const claimed = new Set(
          planDbRows.map((r) => r.ig_media_id).filter((x): x is string => !!x),
        );
        const linkPatches: Array<{ id: string; ig_media_id: string; published_at: string | null }> = [];
        for (const row of planDbRows) {
          if (row.ig_media_id) continue;
          const itemLite = {
            igMediaId: row.ig_media_id,
            autopostId: row.autopost_id,
            description: row.description,
            title: row.title,
            publishedAt: row.published_at,
            scheduledAt: row.scheduled_at,
            createdAt: row.created_at,
          };
          const resolved = resolveIgMediaIdForPlan({
            plan: itemLite,
            media,
            publishedByAutopost,
            claimedMediaIds: claimed,
          });
          if (!resolved) continue;
          claimed.add(resolved);
          const m = mediaById.get(resolved);
          linkPatches.push({
            id: row.id,
            ig_media_id: resolved,
            published_at: row.published_at ?? m?.timestamp ?? new Date().toISOString(),
          });
        }

        if (linkPatches.length > 0) {
          await Promise.all(
            linkPatches.map((p) =>
              supabase
                .from("content_plan_items" as never)
                .update({
                  ig_media_id: p.ig_media_id,
                  status: "published",
                  published_at: p.published_at,
                } as never)
                .eq("id", p.id),
            ),
          );
          const refreshed = await supabase
            .from("content_plan_items" as never)
            .select("*")
            .eq("project_id", projectId)
            .order("scheduled_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false });
          if (!refreshed.error) {
            planDbRows = (refreshed.data ?? []) as unknown as DbRow[];
          } else {
            for (const p of linkPatches) {
              const row = planDbRows.find((r) => r.id === p.id);
              if (!row) continue;
              row.ig_media_id = p.ig_media_id;
              row.published_at = p.published_at;
              row.status = "published";
            }
          }
        }
      }

      // 2) Импорт ручных (и любых) IG-постов, которых ещё нет в плане.
      if (!planRes.error && !missingTable) {
        const linked = new Set(
          planDbRows.map((r) => r.ig_media_id).filter((x): x is string => !!x),
        );
        const orphans = mediaNotLinkedToPlan(media, linked);
        if (orphans.length > 0) {
          const inserts = orphans.map((m) => {
            const d = draftFromIgMedia(m, codewords);
            return {
              project_id: projectId,
              title: d.title,
              category: "content",
              content_type: d.contentType,
              status: d.status,
              description: d.description,
              media_url: d.mediaUrl,
              thumbnail_url: d.thumbnailUrl,
              scheduled_at: d.scheduledAt,
              published_at: d.publishedAt,
              ig_media_id: d.igMediaId,
              codeword_id: d.codewordId,
              codeword: d.codeword,
              post_instagram: true,
              post_facebook: false,
              post_threads: false,
              post_telegram: false,
              post_linkedin: false,
            };
          });
          const { error: importErr } = await supabase
            .from("content_plan_items" as never)
            .insert(inserts as never);
          if (!importErr || /duplicate|unique/i.test(importErr.message)) {
            const refreshed = await supabase
              .from("content_plan_items" as never)
              .select("*")
              .eq("project_id", projectId)
              .order("scheduled_at", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false });
            if (!refreshed.error) {
              planDbRows = (refreshed.data ?? []) as unknown as DbRow[];
            }
          }
        }
      }

      const leadLite = leads.map((l) => ({
        id: l.id,
        stage_role: l.stage_role,
        paid: l.paid,
        amount: l.amount,
        deposit_amount: l.deposit_amount,
        webinar_status: l.webinar_status,
      }));

      const planRows = planDbRows.map((row) => {
        const funnel = buildContentPlanFunnel({
          adSpend: Number(row.ad_spend ?? 0),
          media: row.ig_media_id ? mediaById.get(row.ig_media_id) ?? null : null,
          igMediaId: row.ig_media_id,
          codewordId: row.codeword_id,
          events,
          leads: leadLite,
          codewordStats: row.codeword_id ? statsByCodewordId.get(row.codeword_id) ?? null : null,
        });
        const item = fromDb(row, funnel);
        if (row.ig_media_id && !row.autopost_id) item.source = "ig_media";
        else if (row.autopost_id) item.source = "autopost";
        return item;
      });

      setItems(planRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки контент-плана");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch, tick]);

  const summary = useMemo(() => summarizeContentPlan(items), [items]);

  const create = useCallback(
    async (draft: ContentPlanDraft) => {
      if (!projectId) throw new Error("Сначала выберите проект");
      if (tableMissing) {
        throw new Error(
          "Таблица content_plan_items ещё не в БД — примените миграцию 20260719150000_content_plan_items.sql",
        );
      }
      const platforms = draft.platforms ?? {};
      const { data, error: err } = await supabase
        .from("content_plan_items" as never)
        .insert({
          project_id: projectId,
          title: draft.title.trim(),
          category: draft.category,
          content_type: draft.contentType,
          status: draft.status,
          description: draft.description ?? null,
          hashtags: draft.hashtags ?? null,
          prompts: draft.prompts ?? null,
          comments_notes: draft.commentsNotes ?? null,
          media_url: draft.mediaUrl ?? null,
          thumbnail_url: draft.thumbnailUrl ?? null,
          scheduled_at: draft.scheduledAt ?? null,
          codeword_id: draft.codewordId ?? null,
          codeword: draft.codeword ?? null,
          post_instagram: platforms.instagram ?? true,
          post_facebook: platforms.facebook ?? false,
          post_threads: platforms.threads ?? false,
          post_telegram: platforms.telegram ?? false,
          post_linkedin: platforms.linkedin ?? false,
          ad_spend: draft.adSpend ?? 0,
        } as never)
        .select("id")
        .single();
      if (err) throw new Error(err.message);
      await refetch();
      return (data as { id: string }).id;
    },
    [projectId, refetch, tableMissing],
  );

  const update = useCallback(
    async (id: string, patch: Partial<ContentPlanDraft> & { aiAnalysis?: string | null; igMediaId?: string | null; autopostId?: string | null }) => {
      if (id.startsWith("cw:") || id.startsWith("ig:")) {
        throw new Error("Сначала добавьте публикацию в контент-план (кнопка «В план»)");
      }
      const payload: Record<string, unknown> = {};
      if (patch.title !== undefined) payload.title = patch.title.trim();
      if (patch.category !== undefined) payload.category = patch.category;
      if (patch.contentType !== undefined) payload.content_type = patch.contentType;
      if (patch.status !== undefined) payload.status = patch.status;
      if (patch.description !== undefined) payload.description = patch.description;
      if (patch.hashtags !== undefined) payload.hashtags = patch.hashtags;
      if (patch.prompts !== undefined) payload.prompts = patch.prompts;
      if (patch.commentsNotes !== undefined) payload.comments_notes = patch.commentsNotes;
      if (patch.mediaUrl !== undefined) payload.media_url = patch.mediaUrl;
      if (patch.thumbnailUrl !== undefined) payload.thumbnail_url = patch.thumbnailUrl;
      if (patch.scheduledAt !== undefined) payload.scheduled_at = patch.scheduledAt;
      if (patch.codewordId !== undefined) payload.codeword_id = patch.codewordId;
      if (patch.codeword !== undefined) payload.codeword = patch.codeword;
      if (patch.adSpend !== undefined) payload.ad_spend = patch.adSpend;
      if (patch.aiAnalysis !== undefined) payload.ai_analysis = patch.aiAnalysis;
      if (patch.igMediaId !== undefined) payload.ig_media_id = patch.igMediaId;
      if (patch.autopostId !== undefined) payload.autopost_id = patch.autopostId;
      if (patch.platforms) {
        if (patch.platforms.instagram !== undefined) payload.post_instagram = patch.platforms.instagram;
        if (patch.platforms.facebook !== undefined) payload.post_facebook = patch.platforms.facebook;
        if (patch.platforms.threads !== undefined) payload.post_threads = patch.platforms.threads;
        if (patch.platforms.telegram !== undefined) payload.post_telegram = patch.platforms.telegram;
        if (patch.platforms.linkedin !== undefined) payload.post_linkedin = patch.platforms.linkedin;
      }
      const { error: err } = await supabase
        .from("content_plan_items" as never)
        .update(payload as never)
        .eq("id", id);
      if (err) throw new Error(err.message);
      await refetch();
    },
    [refetch],
  );

  const remove = useCallback(
    async (id: string) => {
      if (id.startsWith("cw:") || id.startsWith("ig:")) return;
      const { error: err } = await supabase.from("content_plan_items" as never).delete().eq("id", id);
      if (err) throw new Error(err.message);
      await refetch();
    },
    [refetch],
  );

  const adoptSynthetic = useCallback(
    async (item: ContentPlanItem) => {
      if (!projectId) throw new Error("no project");
      if (!item.synthetic) return item.id;
      return create({
        title: item.title,
        category: item.category,
        contentType: item.contentType,
        status: item.status,
        description: item.description,
        mediaUrl: item.mediaUrl,
        thumbnailUrl: item.thumbnailUrl,
        scheduledAt: item.scheduledAt,
        codewordId: item.codewordId,
        codeword: item.codeword,
        platforms: item.platforms,
      });
    },
    [create, projectId],
  );

  return {
    items,
    summary,
    loading,
    error,
    tableMissing,
    refetch,
    create,
    update,
    remove,
    adoptSynthetic,
  };
}

export function useContentPlanItem(id: string | undefined) {
  const { items, loading, error, update, remove, adoptSynthetic, refetch, tableMissing } = useContentPlan();
  const item = useMemo(() => items.find((i) => i.id === id) ?? null, [items, id]);
  return { item, loading, error, update, remove, adoptSynthetic, refetch, tableMissing };
}
