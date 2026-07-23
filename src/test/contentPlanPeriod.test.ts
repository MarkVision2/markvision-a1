import { describe, expect, it } from "vitest";
import {
  CONTENT_PLAN_STATS_START_YMD,
  emptyFunnel,
  filterContentPlanByPeriod,
  partitionContentPlan,
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
    from: new Date(2026, 6, 20),
    to: new Date(2026, 6, 31),
  };

  it("keeps items by publishedAt inside range", () => {
    const items = [
      item({ id: "in", publishedAt: "2026-07-21T12:00:00+05:00" }),
      item({ id: "out", publishedAt: "2026-06-10T12:00:00.000Z" }),
    ];
    expect(filterContentPlanByPeriod(items, range).map((i) => i.id)).toEqual(["in"]);
  });

  it("falls back to scheduledAt then createdAt", () => {
    const items = [
      item({ id: "sched", status: "scheduled", scheduledAt: "2026-07-22T09:00:00+05:00" }),
      item({ id: "created", createdAt: "2026-07-25T09:00:00+05:00" }),
      item({ id: "old", createdAt: "2026-05-01T09:00:00.000Z" }),
    ];
    expect(filterContentPlanByPeriod(items, range).map((i) => i.id)).toEqual(["sched", "created"]);
  });

  it("keeps tomorrow scheduled even if publishedAt is old", () => {
    const items = [
      item({
        id: "tomorrow",
        status: "scheduled",
        scheduledAt: "2026-07-21T09:00:00+05:00",
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    expect(filterContentPlanByPeriod(items, range).map((i) => i.id)).toEqual(["tomorrow"]);
  });

  it(`hard-hides everything before ${CONTENT_PLAN_STATS_START_YMD} even if period includes them`, () => {
    const items = [
      item({ id: "jul18", status: "published", publishedAt: "2026-07-18T09:00:00+05:00" }),
      item({ id: "jul19", status: "published", publishedAt: "2026-07-19T20:21:00+05:00" }),
      item({ id: "jul20", status: "published", publishedAt: "2026-07-20T01:00:00+05:00" }),
    ];
    const wholeJuly = {
      from: new Date(2026, 6, 1),
      to: new Date(2026, 6, 31),
    };
    expect(filterContentPlanByPeriod(items, wholeJuly).map((i) => i.id)).toEqual(["jul20"]);
  });

  it("from-tomorrow range hides already published Jul 18–19 posts", () => {
    const items = [
      item({ id: "jul18", status: "published", publishedAt: "2026-07-18T09:00:00+05:00" }),
      item({ id: "jul19", status: "published", publishedAt: "2026-07-19T15:00:00+05:00" }),
      item({
        id: "jul20",
        status: "scheduled",
        scheduledAt: "2026-07-20T09:00:00+05:00",
      }),
    ];
    const fromTomorrow = {
      from: new Date(2026, 6, 20),
      to: new Date(2026, 8, 18),
    };
    expect(filterContentPlanByPeriod(items, fromTomorrow).map((i) => i.id)).toEqual(["jul20"]);
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

describe("partitionContentPlan", () => {
  it("splits upcoming vs published and sorts by date", () => {
    const items = [
      item({
        id: "pub-old",
        status: "published",
        publishedAt: "2026-07-21T10:00:00+05:00",
      }),
      item({
        id: "pub-new",
        status: "published",
        publishedAt: "2026-07-23T10:00:00+05:00",
      }),
      item({
        id: "later",
        status: "scheduled",
        scheduledAt: "2026-07-25T09:00:00+05:00",
      }),
      item({
        id: "sooner",
        status: "scheduled",
        scheduledAt: "2026-07-22T09:00:00+05:00",
      }),
      item({ id: "draft", status: "ready", scheduledAt: "2026-07-24T09:00:00+05:00" }),
    ];
    const { upcoming, published } = partitionContentPlan(items);
    expect(upcoming.map((i) => i.id)).toEqual(["sooner", "draft", "later"]);
    expect(published.map((i) => i.id)).toEqual(["pub-new", "pub-old"]);
  });
});
