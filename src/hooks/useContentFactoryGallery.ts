import { useCallback, useEffect, useRef, useState } from "react";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  cacheGalleryItem,
  findBatchItemMeta,
  getCachedGalleryItems,
  getPendingRequestIds,
  markRequestSaved,
  type CachedGalleryItem,
} from "@/lib/contentFactoryGalleryStore";

export interface GalleryItem {
  id: string;
  project_id: string;
  request_id: string | null;
  session_id: string | null;
  type_id: string | null;
  type_title: string | null;
  style_id: string | null;
  style_label: string | null;
  image_url: string;
  prompt_snapshot: string | null;
  brand_template_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  /** Откуда показана карточка: основная БД, results или локальный кэш */
  source?: "db" | "results" | "cache";
}

export interface SaveGalleryInput {
  requestId: string;
  sessionId: string;
  typeId: string;
  typeTitle: string;
  styleId: string;
  styleLabel: string;
  imageUrl: string;
  promptSnapshot?: string;
  brandTemplateId?: string | null;
  metadata?: Record<string, unknown>;
}

function isTableMissingError(message: string, code?: string): boolean {
  return code === "PGRST205" || /Could not find the table/i.test(message);
}

function rowToGalleryItem(row: Record<string, unknown>, source: GalleryItem["source"] = "db"): GalleryItem {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    request_id: (row.request_id as string | null) ?? null,
    session_id: (row.session_id as string | null) ?? null,
    type_id: (row.type_id as string | null) ?? null,
    type_title: (row.type_title as string | null) ?? null,
    style_id: (row.style_id as string | null) ?? null,
    style_label: (row.style_label as string | null) ?? null,
    image_url: String(row.image_url),
    prompt_snapshot: (row.prompt_snapshot as string | null) ?? null,
    brand_template_id: (row.brand_template_id as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at ?? new Date().toISOString()),
    source,
  };
}

function cachedToGalleryItem(c: CachedGalleryItem): GalleryItem {
  return {
    id: c.id,
    project_id: c.project_id,
    request_id: c.request_id,
    session_id: c.session_id,
    type_id: c.type_id,
    type_title: c.type_title,
    style_id: c.style_id,
    style_label: c.style_label,
    image_url: c.image_url,
    prompt_snapshot: c.prompt_snapshot,
    brand_template_id: c.brand_template_id,
    metadata: c.metadata,
    created_at: c.created_at,
    source: c.source,
  };
}

function mergeGalleryItems(...lists: GalleryItem[][]): GalleryItem[] {
  const byRequest = new Map<string, GalleryItem>();
  const priority = { db: 3, results: 2, cache: 1 };
  for (const list of lists) {
    for (const item of list) {
      const key = item.request_id ?? item.id;
      const prev = byRequest.get(key);
      if (!prev || (priority[item.source ?? "db"] ?? 0) >= (priority[prev.source ?? "db"] ?? 0)) {
        byRequest.set(key, item);
      }
    }
  }
  return Array.from(byRequest.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function useContentFactoryGallery() {
  const { user } = useAuth();
  const { activeId: projectId } = useProjectsStore();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const savedRequestIdsRef = useRef<Set<string>>(new Set());
  const saveItemRef = useRef<(input: SaveGalleryInput) => Promise<boolean>>(async () => false);

  const fetchReadyFromResults = useCallback(
    async (requestIds: string[]): Promise<GalleryItem[]> => {
      if (!clientConfigSupabase || !projectId || requestIds.length === 0) return [];

      const { data, error } = await clientConfigSupabase
        .from("content_factory_results")
        .select("request_id, status, image_url, style_id, style_label, created_at, updated_at")
        .in("request_id", requestIds)
        .eq("status", "ready")
        .not("image_url", "is", null);

      if (error) {
        console.warn("[gallery] results fetch", error.message);
        return [];
      }

      const out: GalleryItem[] = [];
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>;
        const requestId = String(r.request_id ?? "");
        if (!requestId) continue;
        const meta = findBatchItemMeta(projectId, requestId);
        out.push({
          id: `result:${requestId}`,
          project_id: projectId,
          request_id: requestId,
          session_id: meta?.batchId ?? null,
          type_id: meta?.typeId ?? (r.style_id as string | null) ?? null,
          type_title: meta?.typeTitle ?? null,
          style_id: meta?.styleId ?? (r.style_id as string | null) ?? null,
          style_label: meta?.styleLabel ?? (r.style_label as string | null) ?? null,
          image_url: String(r.image_url),
          prompt_snapshot: meta?.promptSnapshot ?? null,
          brand_template_id: meta?.brandTemplateId ?? null,
          metadata: { source: "content_factory_results" },
          created_at: String(r.updated_at ?? r.created_at ?? new Date().toISOString()),
          source: "results",
        });
      }
      return out;
    },
    [projectId],
  );

  const load = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLastError(null);

    let dbItems: GalleryItem[] = [];
    try {
      const { data, error } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
        typeof supabase.from
      >)
        .select(
          "id, project_id, request_id, session_id, type_id, type_title, style_id, style_label, image_url, prompt_snapshot, brand_template_id, metadata, created_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        if (isTableMissingError(error.message, error.code)) {
          setNeedsMigration(true);
          setLastError(
            "Таблица галереи не найдена в Supabase — примените миграцию 20260606160000_content_factory_gallery_brand.sql",
          );
        } else {
          setLastError(error.message);
          console.warn("[gallery] load", error.message);
        }
      } else {
        setNeedsMigration(false);
        dbItems = ((data ?? []) as Record<string, unknown>[]).map((r) => rowToGalleryItem(r, "db"));
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Ошибка загрузки галереи");
    }

    const savedIds = new Set(
      dbItems.map((i) => i.request_id).filter((id): id is string => Boolean(id)),
    );
    savedRequestIdsRef.current = savedIds;

    const pendingIds = getPendingRequestIds(projectId, savedIds);
    const resultItems = await fetchReadyFromResults(pendingIds);

    const cacheItems = getCachedGalleryItems(projectId).map(cachedToGalleryItem);

    const merged = mergeGalleryItems(dbItems, resultItems, cacheItems);
    setItems(merged);
    setLoading(false);

    // Авто-backfill: готовые results → основная галерея (или локальный кэш)
    for (const item of resultItems) {
      if (!item.request_id || savedIds.has(item.request_id)) continue;
      const meta = findBatchItemMeta(projectId, item.request_id);
      if (!meta) continue;
      void saveItemRef.current({
        requestId: item.request_id,
        sessionId: meta.batchId,
        typeId: meta.typeId,
        typeTitle: meta.typeTitle,
        styleId: meta.styleId,
        styleLabel: meta.styleLabel,
        imageUrl: item.image_url,
        promptSnapshot: meta.promptSnapshot,
        brandTemplateId: meta.brandTemplateId,
        metadata: { source: "backfill" },
      });
    }
  }, [projectId, fetchReadyFromResults]);

  const saveItemInternal = useCallback(
    async (input: SaveGalleryInput): Promise<boolean> => {
      if (!projectId || !input.imageUrl) return false;

      const cacheFallback = (): boolean => {
        const cached: CachedGalleryItem = {
          id: `cache:${input.requestId}`,
          project_id: projectId,
          request_id: input.requestId,
          session_id: input.sessionId,
          type_id: input.typeId,
          type_title: input.typeTitle,
          style_id: input.styleId,
          style_label: input.styleLabel,
          image_url: input.imageUrl,
          prompt_snapshot: input.promptSnapshot ?? null,
          brand_template_id: input.brandTemplateId ?? null,
          metadata: input.metadata ?? { source: "cache" },
          created_at: new Date().toISOString(),
          source: "cache",
        };
        cacheGalleryItem(projectId, cached);
        setItems((prev) => mergeGalleryItems(prev, [cachedToGalleryItem(cached)]));
        return true;
      };

      if (!user?.id) {
        return cacheFallback();
      }

      try {
        const { data: existing } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
          typeof supabase.from
        >)
          .select("id")
          .eq("project_id", projectId)
          .eq("request_id", input.requestId)
          .maybeSingle();

        if (existing) {
          markRequestSaved(projectId, input.requestId);
          savedRequestIdsRef.current.add(input.requestId);
          return true;
        }

        const baseRow = {
          project_id: projectId,
          created_by: user.id,
          request_id: input.requestId,
          session_id: input.sessionId,
          type_id: input.typeId,
          type_title: input.typeTitle,
          style_id: input.styleId,
          style_label: input.styleLabel,
          image_url: input.imageUrl,
          prompt_snapshot: input.promptSnapshot ?? null,
          brand_template_id: input.brandTemplateId ?? null,
          metadata: input.metadata ?? {},
        };

        let { error } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
          typeof supabase.from
        >).insert(baseRow);

        if (error && input.brandTemplateId && /brand_template|foreign key/i.test(error.message)) {
          ({ error } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
            typeof supabase.from
          >).insert({ ...baseRow, brand_template_id: null }));
        }

        if (error) {
          if (isTableMissingError(error.message, error.code)) {
            setNeedsMigration(true);
          }
          console.warn("[gallery] save", error.message);
          return cacheFallback();
        }

        markRequestSaved(projectId, input.requestId);
        savedRequestIdsRef.current.add(input.requestId);
        await load();
        return true;
      } catch (e) {
        console.warn("[gallery] save exception", e);
        return cacheFallback();
      }
    },
    [projectId, user?.id, load],
  );

  saveItemRef.current = saveItemInternal;

  useEffect(() => {
    void load();
  }, [load]);

  // Пока есть незавершённые request_id — опрашиваем content_factory_results
  useEffect(() => {
    if (!projectId || !clientConfigSupabase) return;

    const tick = () => {
      const saved = savedRequestIdsRef.current;
      const pending = getPendingRequestIds(projectId, saved);
      if (pending.length === 0) return;
      void load();
    };

    const interval = window.setInterval(tick, 12_000);
    return () => window.clearInterval(interval);
  }, [projectId, load, items.length]);

  const removeItem = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item?.source === "cache" || item?.source === "results") {
        if (item.request_id) markRequestSaved(projectId!, item.request_id);
        setItems((prev) => prev.filter((i) => i.id !== id));
        return;
      }

      const { error } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
        typeof supabase.from
      >)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
      if (item?.request_id) markRequestSaved(projectId!, item.request_id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [items, projectId],
  );

  return {
    items,
    loading,
    load,
    saveItem: saveItemInternal,
    removeItem,
    projectId,
    needsMigration,
    lastError,
  };
}
