/**
 * Радар идей: прямой сборщик Apify (supabase/functions/_lib/radarCrawl.ts) —
 * выбор актора и входа по источнику/ссылке, разворачивание ответа актора,
 * оценка расхода. То, что молча ломает сбор: неверный вход актора,
 * потерянные подписчики у постов профиля, неразобранная ссылка.
 */
import { describe, expect, it } from "vitest";
import {
  APIFY_ACTORS,
  apifyCostUsd,
  apifyHttpErrorMessage,
  apifyRunFailureMessage,
  buildSourceRun,
  buildUrlRun,
  crawlUnsupportedReason,
  detectUrlPlatform,
  flattenApifyItems,
  isApifyRunFinished,
} from "../../supabase/functions/_lib/radarCrawl.ts";
import { normalizeIngestItem } from "../../supabase/functions/_lib/radar.ts";

describe("detectUrlPlatform", () => {
  it("распознаёт площадки по хосту, мусор → null", () => {
    expect(detectUrlPlatform("https://www.instagram.com/reel/C1abc/")).toBe("instagram");
    expect(detectUrlPlatform("https://www.tiktok.com/@a/video/7300")).toBe("tiktok");
    expect(detectUrlPlatform("https://vm.tiktok.com/ZM123/")).toBe("tiktok");
    expect(detectUrlPlatform("https://youtu.be/xObhZ0Ga7EQ")).toBe("youtube");
    expect(detectUrlPlatform("https://www.youtube.com/shorts/abc")).toBe("youtube");
    expect(detectUrlPlatform("https://www.threads.net/@a/post/1")).toBe("threads");
    expect(detectUrlPlatform("https://fb.watch/xyz/")).toBe("facebook");
    expect(detectUrlPlatform("https://vk.com/video1")).toBeNull();
    expect(detectUrlPlatform("не ссылка")).toBeNull();
  });
});

describe("buildSourceRun", () => {
  it("Instagram-аккаунт → details профиля (подписчики + последние посты)", () => {
    const run = buildSourceRun({ kind: "competitor_account", platform: "instagram", handle: "@clinic/" })!;
    expect(run.actor).toBe(APIFY_ACTORS.instagram);
    expect(run.input.directUrls).toEqual(["https://www.instagram.com/clinic/"]);
    expect(run.input.resultsType).toBe("details");
  });

  it("Instagram-хештег → лента постов по тегу", () => {
    const run = buildSourceRun({ kind: "hashtag", platform: "instagram", handle: "#стоматология", limit: 5 })!;
    expect(run.input.directUrls).toEqual(["https://www.instagram.com/explore/tags/стоматология/"]);
    expect(run.input.resultsType).toBe("posts");
    expect(run.input.resultsLimit).toBe(5);
  });

  it("TikTok: профиль и хештег, лимит режется в 1..50", () => {
    expect(buildSourceRun({ kind: "competitor_account", platform: "tiktok", handle: "author", limit: 500 })!.input).toMatchObject({ profiles: ["author"], resultsPerPage: 50 });
    expect(buildSourceRun({ kind: "hashtag", platform: "tiktok", handle: "fyp", limit: 0 })!.input).toMatchObject({ hashtags: ["fyp"], resultsPerPage: 1 });
  });

  it("YouTube: канал по нику или по UC-id, шортсы и видео", () => {
    const byHandle = buildSourceRun({ kind: "competitor_account", platform: "youtube", handle: "@apify" })!;
    expect(byHandle.actor).toBe(APIFY_ACTORS.youtube);
    expect(byHandle.input.startUrls).toEqual([{ url: "https://www.youtube.com/@apify/shorts" }, { url: "https://www.youtube.com/@apify/videos" }]);
    const byId = buildSourceRun({ kind: "competitor_account", platform: "youtube", handle: "UCxxxxxxxxxxxxxxxxxxxxxx" })!;
    expect((byId.input.startUrls as { url: string }[])[0].url).toMatch(/\/channel\/UC/);
  });

  it("неподдерживаемое: Threads/Facebook, библиотека рекламы, пустой ник", () => {
    expect(crawlUnsupportedReason({ kind: "competitor_account", platform: "threads", handle: "a" })).toMatch(/Threads/);
    expect(crawlUnsupportedReason({ kind: "ad_library_query", platform: "facebook", handle: "a" })).toMatch(/библиотека/i);
    expect(crawlUnsupportedReason({ kind: "competitor_account", platform: "instagram", handle: "@" })).toMatch(/ник/);
    expect(crawlUnsupportedReason({ kind: "competitor_account", platform: "instagram", handle: "ok" })).toBeNull();
    expect(buildSourceRun({ kind: "competitor_account", platform: "facebook", handle: "a" })).toBeNull();
  });
});

describe("buildUrlRun", () => {
  it("Instagram: только /p/, /reel/, /tv/; query отбрасывается", () => {
    const run = buildUrlRun("https://www.instagram.com/reel/C1abc/?igsh=1")!;
    expect(run.input.directUrls).toEqual(["https://www.instagram.com/reel/C1abc/"]);
    expect(run.input.resultsLimit).toBe(1);
    expect(buildUrlRun("https://www.instagram.com/clinic/")).toBeNull();
  });
  it("TikTok и YouTube — по прямой ссылке", () => {
    expect(buildUrlRun("https://www.tiktok.com/@a/video/7300")!.input).toMatchObject({ postURLs: ["https://www.tiktok.com/@a/video/7300"] });
    expect(buildUrlRun("https://youtu.be/xObhZ0Ga7EQ")!.input).toMatchObject({ startUrls: [{ url: "https://youtu.be/xObhZ0Ga7EQ" }], maxResults: 1 });
  });
  it("Threads/Facebook и мусор → null", () => {
    expect(buildUrlRun("https://www.threads.net/@a/post/1")).toBeNull();
    expect(buildUrlRun("javascript:alert(1)")).toBeNull();
  });
});

describe("flattenApifyItems", () => {
  it("профиль Instagram разворачивается в посты с подписчиками владельца", () => {
    const items = flattenApifyItems("instagram", [{
      username: "clinic", followersCount: 25000,
      latestPosts: [
        { shortCode: "A1", url: "https://www.instagram.com/p/A1/", likesCount: 10, commentsCount: 2, type: "Video", videoViewCount: 500, timestamp: "2026-09-01T10:00:00.000Z" },
        { shortCode: "A2", url: "https://www.instagram.com/p/A2/", likesCount: 5, commentsCount: 0, type: "Image" },
      ],
    }]);
    expect(items).toHaveLength(2);
    const post = normalizeIngestItem("instagram", items[0])!;
    expect(post.external_id).toBe("A1");
    expect(post.author_handle).toBe("clinic");
    expect(post.followers).toBe(25000);
    expect(post.metrics.views).toBe(500);
  });

  it("YouTube: viewCount/likes/commentsCount/date/channelUsername/numberOfSubscribers", () => {
    const [item] = flattenApifyItems("youtube", [{
      id: "xObhZ0Ga7EQ", url: "https://www.youtube.com/watch?v=xObhZ0Ga7EQ", title: "Как чистить зубы", text: "описание",
      viewCount: 12000, likes: 340, commentsCount: 12, date: "2026-09-01T10:00:00.000Z", type: "shorts",
      channelUsername: "@clinic", numberOfSubscribers: 9000, thumbnailUrl: "https://i.ytimg.com/vi/x/hq.jpg",
    }]);
    const post = normalizeIngestItem("youtube", item)!;
    expect(post.external_id).toBe("xObhZ0Ga7EQ");
    expect(post.author_handle).toBe("@clinic");
    expect(post.metrics).toEqual({ likes: 340, comments: 12, shares: 0, saves: 0, views: 12000 });
    expect(post.followers).toBe(9000);
    expect(post.published_at).toBe("2026-09-01T10:00:00.000Z");
    expect(post.media_type).toBe("shorts");
    expect(post.caption).toBe("Как чистить зубы\n\nописание");
    expect(post.thumbnail_url).toBe("https://i.ytimg.com/vi/x/hq.jpg");
  });

  it("элементы-ошибки актора и мусор пропускаются, TikTok проходит как есть", () => {
    const items = flattenApifyItems("tiktok", [{ error: "not found" }, null, { id: "1", text: "x" }]);
    expect(items).toEqual([{ id: "1", text: "x", platform: "tiktok" }]);
  });
});

describe("статус и стоимость запуска Apify", () => {
  it("терминальные статусы", () => {
    expect(isApifyRunFinished("SUCCEEDED")).toBe(true);
    expect(isApifyRunFinished("FAILED")).toBe(true);
    expect(isApifyRunFinished("RUNNING")).toBe(false);
    expect(apifyRunFailureMessage("TIMED-OUT")).toMatch(/таймаут/);
    expect(apifyRunFailureMessage("FAILED", "Proxy error")).toMatch(/Proxy error/);
  });
  it("ошибки HTTP Apify → понятный текст: лимит, токен, прочее", () => {
    expect(apifyHttpErrorMessage(403, '{"error":{"type":"platform-feature-disabled","message":"Monthly usage hard limit exceeded"}}')).toMatch(/лимит расхода/);
    expect(apifyHttpErrorMessage(401, '{"error":{"type":"token-not-found","message":"x"}}')).toMatch(/APIFY_TOKEN/);
    expect(apifyHttpErrorMessage(429, "")).toMatch(/повторите позже/);
    expect(apifyHttpErrorMessage(500, "<html>oops</html>")).toBe("Apify HTTP 500: <html>oops</html>");
  });

  it("стоимость: результаты × тариф (+ старт TikTok), неизвестный актор — по умолчанию", () => {
    expect(apifyCostUsd(APIFY_ACTORS.instagram, 12)).toBeCloseTo(0.0324, 4);
    expect(apifyCostUsd(APIFY_ACTORS.tiktok, 10)).toBeCloseTo(0.038, 4);
    expect(apifyCostUsd("x~y", 0)).toBe(0);
  });
});
