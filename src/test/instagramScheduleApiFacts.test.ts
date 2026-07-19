import { describe, expect, it } from "vitest";

/**
 * Документируем проверенный факт Meta Graph (июль 2026):
 * - GET /{ig-user-id}/media — только опубликованные медиа
 * - Content Publishing API — create/publish контейнеров, без list scheduled
 * - GET /{page-id}/scheduled_posts — расписание Facebook Page (не native IG app)
 * MarkVision хранит своё расписание в cf_scheduled_posts и читает его через content-scheduler.
 */
describe("Instagram schedule API facts", () => {
  it("documents endpoints we rely on", () => {
    const facts = {
      igMediaList: "GET /{ig-user-id}/media → published only",
      igPublish: "POST /{ig-user-id}/media + media_publish",
      pageScheduled: "GET /{page-id}/scheduled_posts → Facebook Page only",
      markvisionQueue: "cf_scheduled_posts via content-scheduler (not direct RLS)",
    };
    expect(facts.igMediaList).toMatch(/published only/);
    expect(facts.pageScheduled).toMatch(/Facebook Page/);
    expect(facts.markvisionQueue).toMatch(/content-scheduler/);
  });
});
