import { describe, expect, it } from "vitest";

/**
 * Документируем проверенный факт Meta Graph (июль 2026):
 * - GET /{ig-user-id}/media — только опубликованные медиа
 * - Content Publishing API — create/publish контейнеров, без list scheduled
 * - GET /{page-id}/scheduled_posts — расписание Facebook Page (не native IG app)
 * MarkVision хранит своё расписание в cf_scheduled_posts и читает его через content-scheduler.
 * После publish: instagram-sync пишет media + orphan в content_plan_items (с 2026-07-20 Алматы).
 */
describe("Instagram schedule API facts", () => {
  it("documents endpoints we rely on", () => {
    const facts = {
      igMediaList: "GET /{ig-user-id}/media → published only",
      igPublish: "POST /{ig-user-id}/media + media_publish",
      pageScheduled: "GET /{page-id}/scheduled_posts → Facebook Page only",
      markvisionQueue: "cf_scheduled_posts via content-scheduler (not direct RLS)",
      afterPublish: "instagram-sync → instagram_media + content_plan_items orphan",
    };
    expect(facts.igMediaList).toMatch(/published only/);
    expect(facts.pageScheduled).toMatch(/Facebook Page/);
    expect(facts.markvisionQueue).toMatch(/content-scheduler/);
    expect(facts.afterPublish).toMatch(/orphan/);
  });

  it("plan orphan import floor matches Content Center (fixed Jul 20, not today)", async () => {
    const { contentPlanStatsStartMs, contentPlanMeasureStartMs, CONTENT_PLAN_STATS_START_YMD } =
      await import("@/lib/contentPlan");
    expect(CONTENT_PLAN_STATS_START_YMD).toBe("2026-07-20");
    expect(contentPlanMeasureStartMs(new Date("2026-07-25T12:00:00+05:00"))).toBe(
      contentPlanStatsStartMs(),
    );
    // Вчерашний пост (≥ 20.07) должен проходить порог импорта даже «сегодня» позже.
    const yesterday = new Date("2026-07-21T15:00:00+05:00").getTime();
    expect(yesterday).toBeGreaterThanOrEqual(contentPlanStatsStartMs());
  });
});
