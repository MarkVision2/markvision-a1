import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { getContentFactoryDb } from "@/lib/contentFactoryDb";
import { CONTENT_TYPES } from "@/data/contentTypes";
import {
  cacheGalleryItem,
  findBatchItemMeta,
  getCachedGalleryItems,
  getGalleryBatches,
  getPendingRequestIds,
  markRequestSaved,
  type CachedGalleryItem,
} from "@/lib/contentFactoryGalleryStore";
import {
  collectAllTrackedRequestIds,
  resolveItemCategory,
} from "@/lib/contentFactoryGalleryUtils";

const GALLERY_LIMIT = 300;

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

const MIGRATION_HINT =
  "Примените supabase/migrations_client_config/007_content_factory_gallery_brand.sql в проекте szfgdruhlebfvcmlvxdk (Clony)";

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

  const sb = getContentFactoryDb();

  const fetchReadyFromResults = useCallback(
    async (requestIds: string[]): Promise<GalleryItem[]> => {
      if (!sb || !projectId || requestIds.length === 0) return [];

      const { data, error } = await sb
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
    [sb, projectId],
  );

  const load = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      return;
    }
    if (!sb) {
      setLastError("VITE_CLIENT_SUPABASE_URL не настроен — галерея недоступна");
      setItems(getCachedGalleryItems(projectId).map(cachedToGalleryItem));
      return;
    }

    setLoading(true);
    setLastError(null);

    let dbItems: GalleryItem[] = [];
    try {
      const { data, error } = await sb
        .from("content_factory_gallery")
        .select(
          "id, project_id, request_id, session_id, type_id, type_title, style_id, style_label, image_url, prompt_snapshot, brand_template_id, metadata, created_at",
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(GALLERY_LIMIT);

      if (error) {
        if (isTableMissingError(error.message, error.code)) {
          setNeedsMigration(true);
          setLastError(MIGRATION_HINT);
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

    const trackedIds = collectAllTrackedRequestIds(projectId, dbItems, getGalleryBatches);
    const pendingIds = getPendingRequestIds(projectId, savedIds);
    const idsToFetch = Array.from(new Set([...trackedIds, ...pendingIds]));
    const resultItems = await fetchReadyFromResults(idsToFetch);
    const cacheItems = getCachedGalleryItems(projectId).map(cachedToGalleryItem);
    const merged = mergeGalleryItems(dbItems, resultItems, cacheItems);
    setItems(merged);
    setLoading(false);

    for (const item of resultItems) {
      if (!item.request_id || savedIds.has(item.request_id)) continue;
      const meta = findBatchItemMeta(projectId, item.request_id);
      const sessionId = meta?.batchId ?? item.session_id ?? item.request_id.split(":")[0] ?? "";
      void saveItemRef.current({
        requestId: item.request_id,
        sessionId,
        typeId: meta?.typeId ?? item.type_id ?? "",
        typeTitle: meta?.typeTitle ?? item.type_title ?? "",
        styleId: meta?.styleId ?? item.style_id ?? "",
        styleLabel: meta?.styleLabel ?? item.style_label ?? "",
        imageUrl: item.image_url,
        promptSnapshot: meta?.promptSnapshot,
        brandTemplateId: meta?.brandTemplateId ?? null,
        metadata: { source: "backfill" },
      });
    }
  }, [projectId, sb, fetchReadyFromResults]);

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

      if (!sb) return cacheFallback();

      try {
        const { data: existing } = await sb
          .from("content_factory_gallery")
          .select("id")
          .eq("project_id", projectId)
          .eq("request_id", input.requestId)
          .maybeSingle();

        if (existing) {
          markRequestSaved(projectId, input.requestId);
          savedRequestIdsRef.current.add(input.requestId);
          return true;
        }

        const typeCategory =
          CONTENT_TYPES.find((t) => t.id === input.typeId)?.category ?? null;
        const baseRow = {
          project_id: projectId,
          created_by: user?.id ?? null,
          request_id: input.requestId,
          session_id: input.sessionId,
          type_id: input.typeId,
          type_title: input.typeTitle,
          style_id: input.styleId,
          style_label: input.styleLabel,
          image_url: input.imageUrl,
          prompt_snapshot: input.promptSnapshot ?? null,
          brand_template_id: input.brandTemplateId ?? null,
          metadata: {
            ...(input.metadata ?? {}),
            ...(typeCategory ? { type_category: typeCategory } : {}),
          },
        };

        let { error } = await sb.from("content_factory_gallery").insert(baseRow);

        if (error && input.brandTemplateId && /brand_template|foreign key/i.test(error.message)) {
          ({ error } = await sb
            .from("content_factory_gallery")
            .insert({ ...baseRow, brand_template_id: null }));
        }

        if (error) {
          if (isTableMissingError(error.message, error.code)) {
            setNeedsMigration(true);
            setLastError(MIGRATION_HINT);
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
    [projectId, sb, user?.id, load],
  );

  saveItemRef.current = saveItemInternal;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId || !sb) return;

    const tick = () => {
      const pending = getPendingRequestIds(projectId, savedRequestIdsRef.current);
      if (pending.length === 0) return;
      void load();
    };

    const interval = window.setInterval(tick, 12_000);
    return () => window.clearInterval(interval);
  }, [projectId, sb, load, items.length]);

  const removeItem = useCallback(
    async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item?.source === "cache" || item?.source === "results") {
        if (item.request_id) markRequestSaved(projectId!, item.request_id);
        setItems((prev) => prev.filter((i) => i.id !== id));
        return;
      }

      if (!sb) throw new Error("Clony Supabase не настроен");

      const { error } = await sb.from("content_factory_gallery").delete().eq("id", id);
      if (error) throw new Error(error.message);
      if (item?.request_id) markRequestSaved(projectId!, item.request_id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [items, projectId, sb],
  );

  const removeItems = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const toRemove = items.filter((i) => ids.includes(i.id));
      const dbIds = toRemove.filter((i) => i.source === "db").map((i) => i.id);
      const localIds = toRemove.filter((i) => i.source !== "db").map((i) => i.id);

      for (const item of toRemove) {
        if (item.request_id && projectId) markRequestSaved(projectId, item.request_id);
      }

      if (dbIds.length > 0) {
        if (!sb) throw new Error("Clony Supabase не настроен");
        const { error } = await sb.from("content_factory_gallery").delete().in("id", dbIds);
        if (error) throw new Error(error.message);
      }

      const removeSet = new Set([...dbIds, ...localIds]);
      setItems((prev) => prev.filter((i) => !removeSet.has(i.id)));
    },
    [items, projectId, sb],
  );

  return {
    items,
    loading,
    load,
    saveItem: saveItemInternal,
    removeItem,
    removeItems,
    resolveCategory: resolveItemCategory,
    projectId,
    needsMigration,
    lastError,
  };
}
