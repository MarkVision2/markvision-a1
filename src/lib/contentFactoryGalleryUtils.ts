import { CONTENT_TYPES, type ContentCategory } from "@/data/contentTypes";
import type { GalleryItem } from "@/hooks/useContentFactoryGallery";

export type GalleryFilterCategory = "all" | ContentCategory;

export const GALLERY_CATEGORY_FILTERS: {
  id: GalleryFilterCategory;
  label: string;
}[] = [
  { id: "all", label: "Все" },
  { id: "ads", label: "Реклама" },
  { id: "content", label: "Контент" },
  { id: "ai", label: "Нейрофото" },
];

const TYPE_CATEGORY = new Map(
  CONTENT_TYPES.map((t) => [t.id, t.category] as const),
);

export function resolveItemCategory(item: GalleryItem): ContentCategory | null {
  const meta = item.metadata?.type_category;
  if (meta === "ads" || meta === "content" || meta === "ai") return meta;
  if (item.type_id) return TYPE_CATEGORY.get(item.type_id) ?? null;
  return null;
}

export function filterByCategory(
  items: GalleryItem[],
  category: GalleryFilterCategory,
): GalleryItem[] {
  if (category === "all") return items;
  return items.filter((item) => resolveItemCategory(item) === category);
}

export interface GallerySessionGroup {
  sessionId: string;
  typeTitle: string | null;
  typeId: string | null;
  category: ContentCategory | null;
  createdAt: string;
  items: GalleryItem[];
}

export interface GalleryDateGroup {
  dateKey: string;
  label: string;
  sessions: GallerySessionGroup[];
  itemCount: number;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateLabel(d: Date, now: Date): string {
  const day = startOfLocalDay(d).getTime();
  const today = startOfLocalDay(now).getTime();
  const diff = today - day;
  const oneDay = 86_400_000;
  if (diff === 0) return "Сегодня";
  if (diff === oneDay) return "Вчера";
  if (diff < 7 * oneDay) {
    return d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function groupGalleryItems(items: GalleryItem[]): GalleryDateGroup[] {
  const now = new Date();
  const byDate = new Map<string, GalleryItem[]>();

  for (const item of items) {
    const d = new Date(item.created_at);
    const key = startOfLocalDay(d).toISOString();
    const list = byDate.get(key) ?? [];
    list.push(item);
    byDate.set(key, list);
  }

  const dateGroups: GalleryDateGroup[] = [];

  for (const [dateKey, dayItems] of byDate) {
    const sortedDay = [...dayItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const bySession = new Map<string, GalleryItem[]>();
    for (const item of sortedDay) {
      const sid = item.session_id ?? `orphan:${item.id}`;
      const list = bySession.get(sid) ?? [];
      list.push(item);
      bySession.set(sid, list);
    }

    const sessions: GallerySessionGroup[] = Array.from(bySession.entries())
      .map(([sessionId, sessionItems]) => {
        const first = sessionItems[0];
        return {
          sessionId,
          typeTitle: first.type_title,
          typeId: first.type_id,
          category: resolveItemCategory(first),
          createdAt: first.created_at,
          items: sessionItems,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    dateGroups.push({
      dateKey,
      label: formatDateLabel(new Date(dateKey), now),
      sessions,
      itemCount: sortedDay.length,
    });
  }

  return dateGroups.sort(
    (a, b) => new Date(b.dateKey).getTime() - new Date(a.dateKey).getTime(),
  );
}

export function collectAllTrackedRequestIds(
  projectId: string,
  dbItems: GalleryItem[],
  getBatches: (pid: string) => { batchId: string; items: { requestId: string }[] }[],
): string[] {
  const ids = new Set<string>();
  for (const batch of getBatches(projectId)) {
    for (const item of batch.items) ids.add(item.requestId);
  }
  for (const item of dbItems) {
    if (item.request_id) ids.add(item.request_id);
  }
  return Array.from(ids);
}
