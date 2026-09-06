/**
 * Радар идей: чистые вычисления витрины трендов и рейтинга авторов
 * (src/lib/radarStats.ts) — X-фактор, норма просмотров, фильтры, сортировки.
 */
import { describe, expect, it } from "vitest";
import type { RadarPost, RadarSource } from "@/lib/radarClient";
import {
  authorStats,
  DEFAULT_TREND_FILTER,
  filterTrends,
  followerBracket,
  formatAge,
  formatUsd,
  formatX,
  hotScore,
  nicheOptions,
  normViews,
  primaryMetric,
  usualMetric,
  xTone, mediaTypeLabel } from "@/lib/radarStats";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");

function post(over: Partial<RadarPost>): RadarPost {
  return {
    id: over.id ?? "p", source_id: null, platform: "instagram", external_id: over.id ?? "p", url: null, author_handle: "a",
    published_at: "2026-09-04T12:00:00.000Z", media_type: "video", caption: null, thumbnail_url: null,
    metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 0 }, followers: 1000, engagement_rate: null, velocity: null,
    score: 50, analysis: null, analysis_status: "done", analyzed_at: null, error: null,
    baseline_views: null, baseline_likes: null, norm_views: null, x_factor: null,
    ...over,
  };
}

describe("normViews / formatX / xTone", () => {
  it("норма просмотров по кривой viralex: 80 тыс. подписчиков ≈ 8 тыс. просмотров", () => {
    expect(normViews(80_156)).toBeGreaterThan(7_500);
    expect(normViews(80_156)).toBeLessThan(8_700);
    expect(normViews(23_183_768)).toBeGreaterThan(350_000);
    expect(normViews(0)).toBeNull();
    expect(normViews(null)).toBeNull();
  });
  it("формат: ×6 811 / ×26 / ×2,6 / —", () => {
    expect(formatX(6811.3).replace(/[\u00a0\u202f]/g, " ")).toBe("×6 811");
    expect(formatX(26.4)).toBe("×26");
    expect(formatX(2.61)).toBe("×2,6");
    expect(formatX(null)).toBe("—");
    expect(formatX(0)).toBe("—");
  });
  it("тон: ≥2 залетел, >1,2 выше нормы, иначе обычный", () => {
    expect(xTone(6)).toBe("viral");
    expect(xTone(1.5)).toBe("above");
    expect(xTone(1)).toBe("normal");
    expect(xTone(null)).toBe("none");
  });
});

describe("formatUsd", () => {
  it("ниже цента показывает три знака — «$0.00» скрывал бы реальные траты", () => {
    expect(formatUsd(0.0212)).toBe("$0.021");
    expect(formatUsd(0.0446)).toBe("$0.045");
    expect(formatUsd(0.009)).toBe("$0.009");
    expect(formatUsd(0.066)).toBe("$0.066");
    expect(formatUsd(0.0004)).toBe("<$0.001");
  });
  it("ровный ноль и обычные суммы", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(null)).toBe("$0");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});

describe("formatAge", () => {
  it("минуты, часы, дни, месяцы", () => {
    expect(formatAge("2026-09-05T11:59:40.000Z", NOW)).toBe("только что");
    expect(formatAge("2026-09-05T11:30:00.000Z", NOW)).toBe("30 мин назад");
    expect(formatAge("2026-09-05T09:00:00.000Z", NOW)).toBe("3 ч назад");
    expect(formatAge("2026-08-31T12:00:00.000Z", NOW)).toBe("5 дн назад");
    expect(formatAge("2026-06-01T12:00:00.000Z", NOW)).toBe("3 мес назад");
    expect(formatAge(null, NOW)).toBe("—");
  });
});

describe("primaryMetric / usualMetric", () => {
  it("просмотры, а без них — лайки; обычно — медиана автора, иначе норма", () => {
    const video = post({ metrics: { likes: 10, comments: 0, shares: 0, saves: 0, views: 5000 }, baseline_views: 1200, norm_views: 900 });
    expect(primaryMetric(video)).toEqual({ value: 5000, kind: "views" });
    expect(usualMetric(video)).toBe(1200);
    const photo = post({ metrics: { likes: 38, comments: 0, shares: 0, saves: 0, views: 0 }, baseline_likes: 25 });
    expect(primaryMetric(photo)).toEqual({ value: 38, kind: "likes" });
    expect(usualMetric(photo)).toBe(25);
    expect(usualMetric(post({ metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 100 }, norm_views: 80 }))).toBe(80);
    expect(usualMetric(post({}))).toBeNull();
  });
});

describe("filterTrends", () => {
  const fresh = post({ id: "fresh", x_factor: 3, published_at: "2026-09-05T06:00:00.000Z", metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 300 }, analysis: { hook: "h", niche: "AI", structure: { problem: "", solution: "", cta: "" }, triggers: [], why_it_works: "", score: 70, idea_title: "", idea_angle: "", script_outline: "" } });
  const old = post({ id: "old", x_factor: 40, published_at: "2026-07-01T00:00:00.000Z", metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 900_000 }, platform: "tiktok" });
  const flat = post({ id: "flat", x_factor: 0.8, published_at: "2026-09-04T00:00:00.000Z", metrics: { likes: 5, comments: 0, shares: 0, saves: 0, views: 100 }, author_handle: "clinic" });

  it("период, площадка, только залетевшие, поиск", () => {
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, period: "week" }, NOW).map((p) => p.id)).toEqual(["fresh", "flat"]);
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, platform: "tiktok" }, NOW).map((p) => p.id)).toEqual(["old"]);
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, viralOnly: true, sort: "x" }, NOW).map((p) => p.id)).toEqual(["old", "fresh"]);
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, query: "CLINIC" }, NOW).map((p) => p.id)).toEqual(["flat"]);
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, niche: "AI" }, NOW).map((p) => p.id)).toEqual(["fresh"]);
  });

  it("сортировки: горячее учитывает свежесть, просмотры и свежие — абсолютные", () => {
    expect(hotScore(fresh, NOW)).toBeGreaterThan(hotScore(flat, NOW));
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, sort: "views" }, NOW)[0].id).toBe("old");
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, sort: "recent" }, NOW)[0].id).toBe("fresh");
    // старый пост с ×40 всё ещё горячее свежего ×3: затухание ограничено 35 % веса
    expect(filterTrends([fresh, old, flat], { ...DEFAULT_TREND_FILTER, sort: "hot" }, NOW)[0].id).toBe("old");
  });

  it("ниши из разборов по частоте", () => {
    expect(nicheOptions([fresh, old, flat])).toEqual([{ niche: "AI", count: 1 }]);
  });
});

describe("authorStats", () => {
  const src: RadarSource = { id: "s1", project_id: "p", kind: "competitor_account", platform: "instagram", handle: "Clinic", label: null, enabled: true, crawl_interval_hours: 24, last_crawled_at: null, last_error: null, created_at: "" };
  const posts = [
    post({ id: "1", author_handle: "clinic", followers: 25_000, x_factor: 6, baseline_views: 1000, metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 6000 } }),
    post({ id: "2", author_handle: "clinic", followers: 25_000, x_factor: 0.9, baseline_views: 1000, metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 900 } }),
    post({ id: "3", author_handle: "clinic", followers: 25_000, x_factor: 2.5, baseline_views: 1000, metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 2500 }, published_at: "2026-09-05T00:00:00.000Z" }),
    post({ id: "4", author_handle: "other", followers: 500, x_factor: 1.1 }),
    post({ id: "5", author_handle: null }),
  ];
  it("считает залетевшие, просмотры сверх нормы, силу и плотность хитов; связывает с источником без учёта регистра", () => {
    const [clinic, other] = authorStats(posts, [src]);
    expect(clinic.handle).toBe("clinic");
    expect(clinic.source?.id).toBe("s1");
    expect(clinic.posts).toBe(3);
    expect(clinic.viral).toBe(2);
    expect(clinic.aboveNorm).toBe(5000 + 1500);
    expect(clinic.strength).toBe(6);
    expect(clinic.hitRate).toBeCloseTo(2 / 3);
    expect(clinic.topPost?.id).toBe("1");
    expect(clinic.lastPublishedAt).toBe("2026-09-05T00:00:00.000Z");
    expect(other.viral).toBe(0);
    expect(authorStats(posts, [], "strength")[0].handle).toBe("clinic");
  });
  it("размерные корзины", () => {
    expect(followerBracket(5_000)).toBe("s");
    expect(followerBracket(50_000)).toBe("m");
    expect(followerBracket(500_000)).toBe("l");
    expect(followerBracket(5_000_000)).toBe("xl");
  });
});

describe("mediaTypeLabel", () => {
  it("сырой тип сборщика → слово для интерфейса", () => {
    expect(mediaTypeLabel("video")).toBe("видео");
    expect(mediaTypeLabel("Video")).toBe("видео");
    expect(mediaTypeLabel("clips")).toBe("reels");
    expect(mediaTypeLabel("reel")).toBe("reels");
    expect(mediaTypeLabel("shorts")).toBe("shorts");
    expect(mediaTypeLabel("sidecar")).toBe("карусель");
    expect(mediaTypeLabel("GraphImage")).toBe("фото");
    expect(mediaTypeLabel("ad")).toBe("объявление");
    expect(mediaTypeLabel(null)).toBe("пост");
    expect(mediaTypeLabel("")).toBe("пост");
    expect(mediaTypeLabel("something")).toBe("something");
  });
});
