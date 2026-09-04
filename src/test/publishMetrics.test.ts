/**
 * Сбор метрик публикаций — чистая часть: нормализация ответов Instagram /
 * Threads / TikTok / YouTube, проверка прав и порог «своего хита» для радара.
 */
import { describe, expect, it } from "vitest";
import { metricsScopeMissing, normalizeInsights, ownPostIsHit } from "../../supabase/functions/_lib/publishMetricsCore.ts";

describe("normalizeInsights", () => {
  it("Instagram: reach/views/likes/comments/shares/saved из insights", () => {
    const m = normalizeInsights("instagram", { data: [
      { name: "reach", values: [{ value: 1200 }] }, { name: "views", values: [{ value: 3400 }] },
      { name: "likes", values: [{ value: 80 }] }, { name: "comments", values: [{ value: 7 }] },
      { name: "shares", values: [{ value: 5 }] }, { name: "saved", values: [{ value: 12 }] },
    ] });
    expect(m).toMatchObject({ reach: 1200, views: 3400, likes: 80, comments: 7, shares: 5, saves: 12 });
  });
  it("Threads: replies → comments, reposts+shares → shares, total_value", () => {
    const m = normalizeInsights("threads", { data: [
      { name: "views", total_value: { value: 900 } }, { name: "likes", total_value: { value: 40 } },
      { name: "replies", total_value: { value: 3 } }, { name: "reposts", total_value: { value: 2 } }, { name: "shares", total_value: { value: 4 } },
    ] });
    expect(m).toMatchObject({ reach: 900, views: 900, likes: 40, comments: 3, shares: 6, saves: 0 });
  });
  it("TikTok: data.videos[0] с *_count, просмотры считаются охватом", () => {
    const m = normalizeInsights("tiktok", { data: { videos: [{ id: "1", view_count: 15000, like_count: 700, comment_count: 30, share_count: 25 }] } });
    expect(m).toMatchObject({ reach: 15000, views: 15000, likes: 700, comments: 30, shares: 25, saves: 0 });
    expect(normalizeInsights("tiktok", { data: { videos: [] } }).views).toBe(0);
  });
  it("YouTube: items[0].statistics со строковыми числами", () => {
    const m = normalizeInsights("youtube", { items: [{ statistics: { viewCount: "5200", likeCount: "310", commentCount: "12", favoriteCount: "0" } }] });
    expect(m).toMatchObject({ reach: 5200, views: 5200, likes: 310, comments: 12, shares: 0, saves: 0 });
    expect(normalizeInsights("youtube", {}).reach).toBe(0);
  });
});

describe("metricsScopeMissing", () => {
  it("TikTok без video.list не отдаёт статистику; пустой scope не считаем ошибкой (старые подключения)", () => {
    expect(metricsScopeMissing("tiktok", "user.info.basic,video.publish,video.upload")).toBe("video.list");
    expect(metricsScopeMissing("tiktok", "user.info.basic,video.publish,video.upload,video.list")).toBeNull();
    expect(metricsScopeMissing("tiktok", null)).toBeNull();
    expect(metricsScopeMissing("youtube", "https://www.googleapis.com/auth/youtube.upload")).toBeNull();
    expect(metricsScopeMissing("instagram", null)).toBeNull();
  });
});

describe("ownPostIsHit", () => {
  it("хит — ≥ 5 % подписчиков или ≥ 10 000 просмотров", () => {
    expect(ownPostIsHit({ reach: 600, views: 600 }, 10000)).toBe(true);
    expect(ownPostIsHit({ reach: 400, views: 400 }, 10000)).toBe(false);
    expect(ownPostIsHit({ reach: 12000, views: 12000 }, null)).toBe(true);
    expect(ownPostIsHit({ reach: 300, views: 300 }, null)).toBe(false);
    expect(ownPostIsHit({ reach: 300, views: 300 }, 0)).toBe(false);
  });
});
