import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/hooks/useContentFactoryGallery";
import {
  filterByCategory,
  groupGalleryItems,
} from "@/lib/contentFactoryGalleryUtils";

function item(partial: Partial<GalleryItem> & { id: string }): GalleryItem {
  return {
    project_id: "p1",
    request_id: null,
    session_id: "sess-1",
    type_id: "insta-carousel",
    type_title: "Карусель Instagram",
    style_id: "ugc",
    style_label: "UGC",
    image_url: "https://cdn.example/a.png",
    prompt_snapshot: null,
    brand_template_id: null,
    metadata: { type_category: "content" },
    created_at: new Date().toISOString(),
    ...partial,
  };
}

describe("contentFactoryGalleryUtils", () => {
  it("фильтрует по категории", () => {
    const items = [
      item({ id: "1", metadata: { type_category: "content" } }),
      item({ id: "2", type_id: "neuro-photo", metadata: { type_category: "ai" } }),
    ];
    expect(filterByCategory(items, "content")).toHaveLength(1);
    expect(filterByCategory(items, "ai")).toHaveLength(1);
    expect(filterByCategory(items, "all")).toHaveLength(2);
  });

  it("группирует по дате и сессии", () => {
    const today = new Date();
    const groups = groupGalleryItems([
      item({ id: "a", session_id: "batch-1", created_at: today.toISOString() }),
      item({ id: "b", session_id: "batch-1", created_at: today.toISOString() }),
      item({ id: "c", session_id: "batch-2", created_at: today.toISOString() }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[0].itemCount).toBe(3);
  });
});
