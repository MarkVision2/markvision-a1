/**
 * AI Content Analyst (_lib/publishInsights.ts): часы в поясе аккаунта, лучшие
 * корзины только при достаточной выборке, рекомендации из чисел.
 */
import { describe, expect, it } from "vitest";
import { buildContentInsights, MIN_SAMPLE, type InsightPublication } from "../../supabase/functions/_lib/publishInsights.ts";

let seq = 0;
const pub = (over: Partial<InsightPublication> & { published_at: string }): InsightPublication => ({
  publication_id: `p${++seq}`,
  content_id: "c1",
  content_title: "Ролик",
  account_id: "a1",
  account_name: "Клиника",
  platform: "instagram",
  status: "published",
  verification_status: "verified",
  views: 100,
  reach: 80,
  likes: 10,
  comments: 1,
  shares: 0,
  saves: 1,
  score: 50,
  metrics_checkpoint: "d1",
  ...over,
});

describe("buildContentInsights", () => {
  it("час публикации считается в поясе аккаунта", () => {
    // 05:30 UTC = 10:30 по Алматы (UTC+5)
    const r = buildContentInsights({
      publications: [pub({ published_at: "2026-09-08T05:30:00Z" })],
      failures: [],
      timezones: { a1: "Asia/Almaty" },
      periodDays: 30,
    });
    expect(r.by_hour.map((b) => b.key)).toEqual(["10"]);
    expect(r.by_weekday.map((b) => b.key)).toEqual(["2"]); // вторник
  });

  it("лучшие часы — только корзины с достаточной выборкой, отсортированы по score", () => {
    const rows: InsightPublication[] = [];
    for (let i = 0; i < MIN_SAMPLE; i++) rows.push(pub({ published_at: `2026-09-0${i + 1}T10:00:00Z`, score: 80, views: 500 }));
    for (let i = 0; i < MIN_SAMPLE; i++) rows.push(pub({ published_at: `2026-09-0${i + 1}T18:00:00Z`, score: 40, views: 200 }));
    rows.push(pub({ published_at: "2026-09-04T13:00:00Z", score: 99, views: 9000 })); // одна публикация — не показатель
    const r = buildContentInsights({ publications: rows, failures: [], timezones: {}, periodDays: 30 });
    expect(r.best_hours).toEqual([10, 18]);
    expect(r.recommendations.some((s) => /Лучшие часы.*10:00, 18:00/.test(s))).toBe(true);
  });

  it("площадки, верификация и ошибки попадают в рекомендации", () => {
    const rows: InsightPublication[] = [];
    for (let i = 0; i < 4; i++) rows.push(pub({ published_at: "2026-09-01T10:00:00Z", platform: "instagram", score: 70 }));
    for (let i = 0; i < 4; i++) rows.push(pub({ published_at: "2026-09-01T10:00:00Z", platform: "tiktok", score: 30, verification_status: i < 2 ? "verified" : "unverified" }));
    const r = buildContentInsights({
      publications: rows,
      failures: [{ error_class: "AUTH_EXPIRED", platform: "tiktok" }, { error_class: "AUTH_EXPIRED", platform: "instagram" }, { error_class: "RATE_LIMIT", platform: "tiktok" }],
      timezones: {},
      periodDays: 7,
    });
    expect(r.by_platform.find((b) => b.key === "tiktok")?.verified_rate).toBe(50);
    expect(r.errors[0]).toEqual({ error_class: "AUTH_EXPIRED", count: 2, platforms: ["instagram", "tiktok"] });
    expect(r.recommendations.some((s) => /лучшим откликом: instagram/.test(s))).toBe(true);
    expect(r.recommendations.some((s) => /tiktok: подтверждено только 50%/.test(s))).toBe(true);
    expect(r.recommendations.some((s) => /AUTH_EXPIRED \(2, 67%/.test(s))).toBe(true);
  });

  it("пусто — честно говорим, что выводов нет", () => {
    const r = buildContentInsights({ publications: [], failures: [], timezones: {}, periodDays: 30 });
    expect(r.publications).toBe(0);
    expect(r.recommendations[0]).toMatch(/публикаций нет/);
  });

  it("аккаунты: топ-5 по score, аутсайдеры только при выборке больше пяти", () => {
    const rows: InsightPublication[] = [];
    for (let i = 0; i < 7; i++) rows.push(pub({ published_at: "2026-09-01T10:00:00Z", account_id: `a${i}`, account_name: `Акк ${i}`, score: 10 * (i + 1) }));
    const r = buildContentInsights({ publications: rows, failures: [], timezones: {}, periodDays: 30 });
    expect(r.accounts_top.map((a) => a.account_name)).toEqual(["Акк 6", "Акк 5", "Акк 4", "Акк 3", "Акк 2"]);
    expect(r.accounts_bottom.map((a) => a.account_name)).toEqual(["Акк 0", "Акк 1", "Акк 2"]);
  });
});
