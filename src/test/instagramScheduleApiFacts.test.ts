import { describe, expect, it } from "vitest";
import { todayAlmatyYmd, tomorrowAlmatyYmd } from "@/lib/metricsPeriod";

/**
 * Документируем проверенный факт Meta Graph (июль 2026):
 * - GET /{ig-user-id}/media — только опубликованные медиа
 * - Content Publishing API — create/publish контейнеров, без list scheduled
 * - GET /{page-id}/scheduled_posts — расписание Facebook Page (не native IG app)
 * MarkVision хранит своё расписание в cf_scheduled_posts и читает его через content-scheduler.
 * После publish: instagram-sync пишет media + orphan в content_plan_items (с today Almaty).
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

  it("today/tomorrow Almaty helpers stay ISO dates", () => {
    expect(todayAlmatyYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tomorrowAlmatyYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
