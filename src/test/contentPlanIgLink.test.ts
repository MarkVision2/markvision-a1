import { describe, expect, it } from "vitest";
import {
  buildContentPlanFunnel,
  contentTypeFromIgMedia,
  draftFromIgMedia,
  isBotUserAgent,
  mediaNotLinkedToPlan,
  normalizeCaptionKey,
  resolveIgMediaIdForPlan,
  titleFromIgCaption,
  type ContentPlanIgMedia,
} from "@/lib/contentPlanIgLink";

const media = (partial: Partial<ContentPlanIgMedia> & { media_id: string }): ContentPlanIgMedia => ({
  caption: null,
  media_type: "VIDEO",
  media_product_type: "REELS",
  permalink: null,
  thumbnail_url: null,
  media_url: null,
  timestamp: "2026-07-10T12:00:00.000Z",
  like_count: 0,
  comments_count: 0,
  shares_count: 0,
  saved_count: 0,
  reach: 0,
  impressions: 0,
  video_views: 0,
  plays: 0,
  ...partial,
});

describe("contentPlanIgLink helpers", () => {
  it("maps IG types and titles", () => {
    expect(contentTypeFromIgMedia({ media_type: "IMAGE", media_product_type: null })).toBe("IMAGE");
    expect(contentTypeFromIgMedia({ media_type: "CAROUSEL_ALBUM", media_product_type: null })).toBe(
      "CAROUSEL",
    );
    expect(titleFromIgCaption("Первая строка\nвторая", "x")).toBe("Первая строка");
    expect(normalizeCaptionKey("  Hello World  \nmore")).toBe("hello world");
  });

  it("resolves media via autopost published id first", () => {
    const id = resolveIgMediaIdForPlan({
      plan: {
        igMediaId: null,
        autopostId: "ap-1",
        description: "caption",
        title: "caption",
        publishedAt: null,
        scheduledAt: "2026-07-10T10:00:00.000Z",
        createdAt: "2026-07-10T09:00:00.000Z",
      },
      media: [media({ media_id: "m1", caption: "caption" })],
      publishedByAutopost: new Map([["ap-1", "m-published"]]),
      claimedMediaIds: new Set(),
    });
    expect(id).toBe("m-published");
  });

  it("soft-matches by caption within 72h", () => {
    const id = resolveIgMediaIdForPlan({
      plan: {
        igMediaId: null,
        autopostId: null,
        description: "Same hook line",
        title: "Same hook line",
        publishedAt: null,
        scheduledAt: "2026-07-10T10:00:00.000Z",
        createdAt: "2026-07-10T09:00:00.000Z",
      },
      media: [
        media({ media_id: "far", caption: "Same hook line", timestamp: "2026-06-01T10:00:00.000Z" }),
        media({ media_id: "near", caption: "Same hook line", timestamp: "2026-07-10T11:00:00.000Z" }),
      ],
      publishedByAutopost: new Map(),
      claimedMediaIds: new Set(),
    });
    expect(id).toBe("near");
  });

  it("lists orphan media for import", () => {
    const orphans = mediaNotLinkedToPlan(
      [media({ media_id: "a" }), media({ media_id: "b" })],
      new Set(["a"]),
    );
    expect(orphans.map((m) => m.media_id)).toEqual(["b"]);
  });

  it("builds funnel from media events (not bots)", () => {
    const f = buildContentPlanFunnel({
      media: media({ media_id: "m1", reach: 1000, plays: 2000, like_count: 50 }),
      igMediaId: "m1",
      events: [
        { id: "1", codeword_id: null, codeword: "x", event_type: "codeword_comment", lead_id: null, reel_id: "m1" },
        { id: "2", codeword_id: null, codeword: "x", event_type: "codeword_dm", lead_id: null, reel_id: "m1" },
        {
          id: "3",
          codeword_id: null,
          codeword: "x",
          event_type: "link_click",
          lead_id: null,
          reel_id: "m1",
          payload: { user_agent: "Mozilla/5.0" },
        },
        {
          id: "4",
          codeword_id: null,
          codeword: "x",
          event_type: "link_click",
          lead_id: null,
          reel_id: "m1",
          payload: { user_agent: "facebookexternalhit/1.1" },
        },
        { id: "5", codeword_id: null, codeword: "x", event_type: "lead", lead_id: "L1", reel_id: "m1" },
      ],
      leads: [
        {
          id: "L1",
          stage_role: "paid",
          paid: true,
          amount: 50000,
          deposit_amount: 0,
          webinar_status: "attended",
        },
      ],
    });
    expect(f.reach).toBe(1000);
    expect(f.views).toBe(2000);
    expect(f.codewordHits).toBe(2);
    expect(f.linkClicks).toBe(1);
    expect(f.registrations).toBe(1);
    expect(f.paid).toBe(1);
    expect(f.revenue).toBe(50000);
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
  });

  it("uses views/impressions as reach when Meta returns reach=0", () => {
    const f = buildContentPlanFunnel({
      media: media({ media_id: "m2", reach: 0, plays: 98, impressions: 98 }),
      igMediaId: "m2",
      events: [],
      leads: [],
    });
    expect(f.reach).toBe(98);
    expect(f.views).toBe(98);
  });

  it("draftFromIgMedia picks codeword from caption", () => {
    const d = draftFromIgMedia(media({ media_id: "m9", caption: "Пиши слово КЕЙС в комменты" }), [
      { id: "cw1", codeword: "кейс", reel_id: null },
    ]);
    expect(d.igMediaId).toBe("m9");
    expect(d.status).toBe("published");
    expect(d.codewordId).toBe("cw1");
    expect(d.contentType).toBe("REELS");
  });
});
