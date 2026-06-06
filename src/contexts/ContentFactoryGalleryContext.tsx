import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { getContentFactoryDb } from "@/lib/contentFactoryDb";
import { CONTENT_TYPES } from "@/data/contentTypes";
import {
  cacheGalleryItem,
  collectKnownSessionIds,
  findBatchItemMeta,
  getCachedGalleryItems,
  getGalleryBatches,
  markRequestSaved,
  type CachedGalleryItem,
} from "@/lib/contentFactoryGalleryStore";
import {
  parseContentFactoryRequestId,
  requestIdBelongsToProject,
} from "@/lib/contentFactoryRequestId";
import { resolveItemCategory } from "@/lib/contentFactoryGalleryUtils";

const GALLERY_LIMIT = 500;
const RESULTS_SCAN_LIMIT = 800;

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

function isUnknownColumnError(message: string): boolean {
  return /column.*does not exist/i.test(message) || /42703/.test(message);
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

function galleryMergeKey(item: GalleryItem): string {
  if (item.source === "db") return `db:${item.id}`;
  const slide = Number(item.metadata?.slide_index ?? 0);
  return `r:${item.request_id ?? item.id}:${slide}`;
}

function mergeGalleryItems(...lists: GalleryItem[][]): GalleryItem[] {
  const byKey = new Map<string, GalleryItem>();
  const priority = { db: 3, results: 2, cache: 1 };
  for (const list of lists) {
    for (const item of list) {
      const key = galleryMergeKey(item);
      const prev = byKey.get(key);
      if (!prev || (priority[item.source ?? "db"] ?? 0) >= (priority[prev.source ?? "db"] ?? 0)) {
        byKey.set(key, item);
      }
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

type GalleryContextValue = {
  items: GalleryItem[];
  loading: boolean;
  load: () => Promise<void>;
  saveItem: (input: SaveGalleryInput) => Promise<boolean>;
  removeItem: (id: string) => Promise<void>;
  removeItems: (ids: string[]) => Promise<void>;
  resolveCategory: typeof resolveItemCategory;
  projectId: string | null;
  needsMigration: boolean;
  lastError: string | null;
};

const GalleryContext = createContext<GalleryContextValue | null>(null);

export function ContentFactoryGalleryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { activeId: projectId } = useProjectsStore();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const savedRequestIdsRef = useRef<Set<string>>(new Set());
  const saveItemRef = useRef<(input: SaveGalleryInput) => Promise<boolean>>(async () => false);

  const sb = getContentFactoryDb();

  const resultRowToItem = useCallback(
    (row: Record<string, unknown>, knownSessions: Set<string>): GalleryItem | null => {
      const requestId = String(row.request_id ?? "");
      if (!requestId || !projectId) return null;
      const rowProject = row.project_id as string | undefined;
      if (rowProject) {
        if (rowProject !== projectId) return null;
      } else if (!requestIdBelongsToProject(requestId, projectId, knownSessions)) {
        return null;
      }

      const meta = findBatchItemMeta(projectId, requestId);
      const parsed = parseContentFactoryRequestId(requestId);
      const slideIndex = Number(row.slide_index ?? 0);

      return {
        id: `result:${requestId}:${slideIndex}`,
        project_id: projectId,
        request_id: requestId,
        session_id:
          (row.session_id as string | null) ??
          meta?.batchId ??
          parsed.batchId ??
          null,
        type_id:
          (row.type_id as string | null) ??
          meta?.typeId ??
          null,
        type_title:
          (row.type_title as string | null) ??
          meta?.typeTitle ??
          null,
        style_id:
          (row.style_id as string | null) ??
          meta?.styleId ??
          parsed.styleId ??
          null,
        style_label:
          (row.style_label as string | null) ??
          meta?.styleLabel ??
          null,
        image_url: String(row.image_url),
        prompt_snapshot: meta?.promptSnapshot ?? null,
        brand_template_id: meta?.brandTemplateId ?? null,
        metadata: {
          source: "content_factory_results",
          slide_index: slideIndex,
        },
        created_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
        source: "results",
      };
    },
    [projectId],
  );

  const fetchAllProjectResults = useCallback(
    async (dbItems: GalleryItem[], knownSessions: Set<string>): Promise<GalleryItem[]> => {
      if (!sb || !projectId) return [];

      const selectMinimal =
        "request_id, status, image_url, style_id, style_label, slide_index, created_at, updated_at";
      const selectExtended = `${selectMinimal}, project_id, session_id, type_id, type_title`;

      const mapRows = (rows: Record<string, unknown>[]) =>
        rows.map((r) => resultRowToItem(r, knownSessions)).filter((x): x is GalleryItem => Boolean(x));

      // 1) По project_id (миграция 010 + n8n пишет project_id)
      const { data: byProject, error: projErr } = await sb
        .from("content_factory_results")
        .select(selectExtended)
        .eq("project_id", projectId)
        .eq("status", "ready")
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(RESULTS_SCAN_LIMIT);

      if (!projErr && byProject?.length) {
        return mapRows(byProject as Record<string, unknown>[]);
      }
      if (projErr && !isUnknownColumnError(projErr.message)) {
        console.warn("[gallery] results by project", projErr.message);
      }

      // 2) По префиксу request_id (новый формат project:batch:style)
      const { data: byPrefix } = await sb
        .from("content_factory_results")
        .select(selectMinimal)
        .like("request_id", `${projectId}:%`)
        .eq("status", "ready")
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(RESULTS_SCAN_LIMIT);

      const fromPrefix = mapRows((byPrefix ?? []) as Record<string, unknown>[]);
      if (fromPrefix.length > 0) return fromPrefix;

      // 3) Fallback: сканируем последние ready и фильтруем по session_id
      const { data: recent, error: recentErr } = await sb
        .from("content_factory_results")
        .select(selectMinimal)
        .eq("status", "ready")
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(RESULTS_SCAN_LIMIT);

      if (recentErr) {
        if (!isUnknownColumnError(recentErr.message)) {
          console.warn("[gallery] results scan", recentErr.message);
        }
        return [];
      }

      return ((recent ?? []) as Record<string, unknown>[])
        .map((r) => resultRowToItem(r, knownSessions))
        .filter((x): x is GalleryItem => Boolean(x));
    },
    [sb, projectId, resultRowToItem],
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

    const dbSessions = dbItems.flatMap((i) => {
      const ids: string[] = [];
      if (i.session_id) ids.push(i.session_id);
      if (i.request_id) {
        const parsed = parseContentFactoryRequestId(i.request_id);
        if (parsed.batchId) ids.push(parsed.batchId);
      }
      return ids;
    });
    const knownSessions = collectKnownSessionIds(projectId, dbSessions);

    const resultItems = await fetchAllProjectResults(dbItems, knownSessions);
    const cacheItems = getCachedGalleryItems(projectId).map(cachedToGalleryItem);
    const merged = mergeGalleryItems(dbItems, resultItems, cacheItems);
    setItems(merged);
    setLoading(false);

    for (const item of resultItems) {
      if (!item.request_id || savedIds.has(item.request_id)) continue;
      const meta = findBatchItemMeta(projectId, item.request_id);
      const parsed = parseContentFactoryRequestId(item.request_id);
      void saveItemRef.current({
        requestId: item.request_id,
        sessionId: item.session_id ?? meta?.batchId ?? parsed.batchId ?? "",
        typeId: item.type_id ?? meta?.typeId ?? "",
        typeTitle: item.type_title ?? meta?.typeTitle ?? "",
        styleId: item.style_id ?? meta?.styleId ?? parsed.styleId ?? "",
        styleLabel: item.style_label ?? meta?.styleLabel ?? "",
        imageUrl: item.image_url,
        promptSnapshot: meta?.promptSnapshot,
        brandTemplateId: meta?.brandTemplateId ?? null,
        metadata: { source: "backfill", slide_index: item.metadata?.slide_index },
      });
    }
  }, [projectId, sb, fetchAllProjectResults]);

  const saveItemInternal = useCallback(
    async (input: SaveGalleryInput): Promise<boolean> => {
      if (!projectId || !input.imageUrl) return false;

      const typeCategory =
        CONTENT_TYPES.find((t) => t.id === input.typeId)?.category ?? null;

      const optimistic: GalleryItem = {
        id: `pending:${input.requestId}`,
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
        metadata: {
          ...(input.metadata ?? {}),
          ...(typeCategory ? { type_category: typeCategory } : {}),
        },
        created_at: new Date().toISOString(),
        source: "cache",
      };

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
          metadata: optimistic.metadata,
          created_at: optimistic.created_at,
          source: "cache",
        };
        cacheGalleryItem(projectId, cached);
        setItems((prev) => mergeGalleryItems(prev, [cachedToGalleryItem(cached)]));
        return true;
      };

      setItems((prev) => mergeGalleryItems(prev, [optimistic]));

      if (!sb) return cacheFallback();

      try {
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
          metadata: optimistic.metadata,
        };

        const { data: existing } = await sb
          .from("content_factory_gallery")
          .select("id")
          .eq("project_id", projectId)
          .eq("request_id", input.requestId)
          .maybeSingle();

        let inserted: { id: string; created_at?: string } | null = null;
        let error: { message: string; code?: string } | null = null;

        if (existing?.id) {
          const res = await sb
            .from("content_factory_gallery")
            .update({
              image_url: input.imageUrl,
              prompt_snapshot: input.promptSnapshot ?? null,
              metadata: optimistic.metadata,
            })
            .eq("id", existing.id)
            .select("id, created_at")
            .maybeSingle();
          inserted = res.data as typeof inserted;
          error = res.error;
        } else {
          let res = await sb
            .from("content_factory_gallery")
            .insert(baseRow)
            .select("id, created_at")
            .maybeSingle();
          if (res.error && input.brandTemplateId && /brand_template|foreign key/i.test(res.error.message)) {
            res = await sb
              .from("content_factory_gallery")
              .insert({ ...baseRow, brand_template_id: null })
              .select("id, created_at")
              .maybeSingle();
          }
          inserted = res.data as typeof inserted;
          error = res.error;
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

        if (inserted) {
          const saved = rowToGalleryItem(
            {
              ...baseRow,
              id: (inserted as { id: string }).id,
              created_at: (inserted as { created_at?: string }).created_at ?? optimistic.created_at,
            },
            "db",
          );
          setItems((prev) =>
            mergeGalleryItems(
              prev.filter((i) => i.request_id !== input.requestId),
              [saved],
            ),
          );
        }
        return true;
      } catch (e) {
        console.warn("[gallery] save exception", e);
        return cacheFallback();
      }
    },
    [projectId, sb, user?.id],
  );

  saveItemRef.current = saveItemInternal;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectId || !sb) return;
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [projectId, sb, load]);

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

      for (const item of toRemove) {
        if (item.request_id && projectId) markRequestSaved(projectId, item.request_id);
      }

      if (dbIds.length > 0) {
        if (!sb) throw new Error("Clony Supabase не настроен");
        const { error } = await sb.from("content_factory_gallery").delete().in("id", dbIds);
        if (error) throw new Error(error.message);
      }

      const removeSet = new Set(ids);
      setItems((prev) => prev.filter((i) => !removeSet.has(i.id)));
    },
    [items, projectId, sb],
  );

  const value: GalleryContextValue = {
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

  return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>;
}

export function useContentFactoryGallery(): GalleryContextValue {
  const ctx = useContext(GalleryContext);
  if (!ctx) {
    throw new Error("useContentFactoryGallery must be used within ContentFactoryGalleryProvider");
  }
  return ctx;
}
