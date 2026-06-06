/**
 * Локальный трекинг генераций контент-завода и кэш галереи.
 * Нужен когда: пользователь ушёл со step-3 до realtime, или INSERT в Supabase не прошёл.
 */

export interface GalleryBatchItem {
  requestId: string;
  styleId: string;
  styleLabel: string;
  promptSnapshot?: string;
}

export interface GalleryBatchTrack {
  batchId: string;
  projectId: string;
  typeId: string;
  typeTitle: string;
  brandTemplateId: string | null;
  createdAt: string;
  items: GalleryBatchItem[];
}

export interface CachedGalleryItem {
  id: string;
  project_id: string;
  request_id: string;
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
  source: "cache" | "results";
}

const STORAGE_KEY = "mv:cfgallery:v1";
const MAX_BATCHES_PER_PROJECT = 120;

interface StorageShape {
  batches: Record<string, GalleryBatchTrack[]>;
  cache: Record<string, CachedGalleryItem[]>;
}

function readStorage(): StorageShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { batches: {}, cache: {} };
    const parsed = JSON.parse(raw) as StorageShape;
    return {
      batches: parsed.batches ?? {},
      cache: parsed.cache ?? {},
    };
  } catch {
    return { batches: {}, cache: {} };
  }
}

function writeStorage(data: StorageShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function registerGalleryBatch(track: GalleryBatchTrack): void {
  if (!track.projectId || !track.batchId) return;
  const data = readStorage();
  const list = data.batches[track.projectId] ?? [];
  const withoutDup = list.filter((b) => b.batchId !== track.batchId);
  const next = [track, ...withoutDup].slice(0, MAX_BATCHES_PER_PROJECT);
  data.batches[track.projectId] = next;
  writeStorage(data);
}

export function getGalleryBatches(projectId: string): GalleryBatchTrack[] {
  if (!projectId) return [];
  return readStorage().batches[projectId] ?? [];
}

export function getPendingRequestIds(projectId: string, savedRequestIds: Set<string>): string[] {
  const pending: string[] = [];
  for (const batch of getGalleryBatches(projectId)) {
    for (const item of batch.items) {
      if (!savedRequestIds.has(item.requestId)) pending.push(item.requestId);
    }
  }
  return Array.from(new Set(pending));
}

export function findBatchItemMeta(
  projectId: string,
  requestId: string,
): (GalleryBatchItem & {
  batchId: string;
  typeId: string;
  typeTitle: string;
  brandTemplateId: string | null;
}) | null {
  for (const batch of getGalleryBatches(projectId)) {
    const item = batch.items.find((i) => i.requestId === requestId);
    if (item) {
      return {
        ...item,
        batchId: batch.batchId,
        typeId: batch.typeId,
        typeTitle: batch.typeTitle,
        brandTemplateId: batch.brandTemplateId,
      };
    }
  }
  return null;
}

export function cacheGalleryItem(projectId: string, item: CachedGalleryItem): void {
  if (!projectId || !item.request_id) return;
  const data = readStorage();
  const list = data.cache[projectId] ?? [];
  const next = [item, ...list.filter((i) => i.request_id !== item.request_id)].slice(0, 200);
  data.cache[projectId] = next;
  writeStorage(data);
}

export function getCachedGalleryItems(projectId: string): CachedGalleryItem[] {
  if (!projectId) return [];
  return readStorage().cache[projectId] ?? [];
}

export function markRequestSaved(projectId: string, requestId: string): void {
  const data = readStorage();
  const cached = data.cache[projectId] ?? [];
  data.cache[projectId] = cached.filter((i) => i.request_id !== requestId);
  writeStorage(data);
}
