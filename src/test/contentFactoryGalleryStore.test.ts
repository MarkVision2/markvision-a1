import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheGalleryItem,
  getCachedGalleryItems,
  getGalleryBatches,
  getPendingRequestIds,
  registerGalleryBatch,
} from "@/lib/contentFactoryGalleryStore";

const PROJECT = "proj-1";

describe("contentFactoryGalleryStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("регистрирует batch и отдаёт pending request_id", () => {
    registerGalleryBatch({
      batchId: "batch-a",
      projectId: PROJECT,
      typeId: "fb-target",
      typeTitle: "Facebook",
      brandTemplateId: null,
      createdAt: new Date().toISOString(),
      items: [
        { requestId: "batch-a:ugc_people", styleId: "ugc_people", styleLabel: "UGC" },
      ],
    });

    expect(getGalleryBatches(PROJECT)).toHaveLength(1);
    expect(getPendingRequestIds(PROJECT, new Set())).toEqual(["batch-a:ugc_people"]);
    expect(getPendingRequestIds(PROJECT, new Set(["batch-a:ugc_people"]))).toEqual([]);
  });

  it("кэширует элементы по project_id", () => {
    cacheGalleryItem(PROJECT, {
      id: "cache:req-1",
      project_id: PROJECT,
      request_id: "req-1",
      session_id: "s1",
      type_id: "t1",
      type_title: "Title",
      style_id: "s1",
      style_label: "Style",
      image_url: "https://cdn.example/a.png",
      prompt_snapshot: null,
      brand_template_id: null,
      metadata: {},
      created_at: new Date().toISOString(),
      source: "cache",
    });
    expect(getCachedGalleryItems(PROJECT)).toHaveLength(1);
  });
});
