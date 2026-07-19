import { describe, expect, it } from "vitest";
import { queuePostToPlanItem } from "@/hooks/useContentPlan";
import { emptyFunnel, type ContentPlanItem } from "@/lib/contentPlan";

function planItem(partial: Partial<ContentPlanItem> & { id: string }): ContentPlanItem {
  return {
    projectId: "p1",
    title: partial.title ?? partial.id,
    category: "content",
    contentType: "IMAGE",
    status: "scheduled",
    description: null,
    hashtags: null,
    prompts: null,
    commentsNotes: null,
    mediaUrl: null,
    thumbnailUrl: null,
    childUrls: [],
    scheduledAt: null,
    publishedAt: null,
    platforms: {
      instagram: true,
      facebook: false,
      threads: false,
      telegram: false,
      linkedin: false,
    },
    autopostId: null,
    igMediaId: null,
    codewordId: null,
    codeword: null,
    utmContent: null,
    adSpend: 0,
    aiAnalysis: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    funnel: emptyFunnel(),
    ...partial,
  };
}

describe("queuePostToPlanItem", () => {
  it("builds a synthetic scheduled plan row from MarkVision queue", () => {
    const item = queuePostToPlanItem(
      {
        id: "q1",
        published_ig_media_id: null,
        media_type: "CAROUSEL",
        caption: "Завтрашний пост\nвторая строка",
        media_url: "https://cdn.example/a.jpg",
        thumbnail_url: "https://cdn.example/t.jpg",
        scheduled_at: "2026-07-20T10:00:00.000Z",
        status: "queued",
      },
      "proj-1",
    );
    expect(item.id).toBe("ap:q1");
    expect(item.synthetic).toBe(true);
    expect(item.source).toBe("autopost");
    expect(item.status).toBe("scheduled");
    expect(item.contentType).toBe("CAROUSEL");
    expect(item.title).toBe("Завтрашний пост");
    expect(item.scheduledAt).toBe("2026-07-20T10:00:00.000Z");
    expect(item.autopostId).toBe("q1");
  });

  it("does not duplicate queue posts already linked in plan", () => {
    const plan = [planItem({ id: "db1", autopostId: "q1", title: "linked" })];
    const queue = [
      {
        id: "q1",
        published_ig_media_id: null,
        caption: "dup",
        scheduled_at: "2026-07-20T10:00:00.000Z",
        status: "queued",
      },
      {
        id: "q2",
        published_ig_media_id: null,
        caption: "orphan",
        scheduled_at: "2026-07-21T10:00:00.000Z",
        status: "queued",
      },
    ];
    const linked = new Set(plan.map((r) => r.autopostId).filter(Boolean));
    const extras = queue
      .filter((p) => !linked.has(String(p.id)))
      .map((p) => queuePostToPlanItem(p, "proj-1"));
    expect(extras.map((i) => i.id)).toEqual(["ap:q2"]);
  });
});
