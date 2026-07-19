import { describe, expect, it } from "vitest";
import {
  emptyFunnel,
  filterContentPlanByPeriod,
  summarizeContentPlan,
  type ContentPlanItem,
} from "@/lib/contentPlan";

function item(partial: Partial<ContentPlanItem> & { id: string }): ContentPlanItem {
  return {
    projectId: "p1",
    title: partial.title ?? partial.id,
    category: "content",
    contentType: "REELS",
    status: "published",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    funnel: emptyFunnel(),
    ...partial,
  };
}

describe("filterContentPlanByPeriod", () => {
  const range = {
    from: new Date(2026, 6, 1),
    to: new Date(2026, 6, 19),
  };

  it("keeps items by publishedAt inside range", () => {
    const items = [
      item({ id: "in", publishedAt: "2026-07-10T12:00:00.000Z" }),
      item({ id: "out", publishedAt: "2026-06-10T12:00:00.000Z" }),
    ];
    expect(filterContentPlanByPeriod(items, range).map((i) => i.id)).toEqual(["in"]);
  });

  it("falls back to scheduledAt then createdAt", () => {
    const items = [
      item({ id: "sched", scheduledAt: "2026-07-05T09:00:00.000Z" }),
      item({ id: "created", createdAt: "2026-07-18T09:00:00.000Z" }),
      item({ id: "old", createdAt: "2026-05-01T09:00:00.000Z" }),
    ];
    expect(filterContentPlanByPeriod(items, range).map((i) => i.id)).toEqual(["sched", "created"]);
  });

  it("keeps tomorrow scheduled even if publishedAt is old", () => {
    const items = [
      item({
        id: "tomorrow",
        status: "scheduled",
        scheduledAt: "2026-07-20T09:00:00.000Z",
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    const fromToday = {
      from: new Date(2026, 6, 19),
      to: new Date(2026, 6, 31),
    };
    expect(filterContentPlanByPeriod(items, fromToday).map((i) => i.id)).toEqual(["tomorrow"]);
  });
});

describe("summarizeContentPlan", () => {
  it("aggregates plan and funnel metrics", () => {
    const items = [
      item({
        id: "a",
        status: "published",
        funnel: { ...emptyFunnel(), reach: 100, linkClicks: 2, revenue: 1000 },
      }),
      item({
        id: "b",
        status: "scheduled",
        funnel: { ...emptyFunnel(), reach: 50, linkClicks: 1, revenue: 500 },
      }),
      item({ id: "c", status: "idea" }),
    ];
    const s = summarizeContentPlan(items);
    expect(s.total).toBe(3);
    expect(s.published).toBe(1);
    expect(s.scheduled).toBe(1);
    expect(s.awaitingCreation).toBe(1);
    expect(s.avgReach).toBe(100);
    expect(s.leads).toBe(3);
    expect(s.revenue).toBe(1500);
  });
});
