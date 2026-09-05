/**
 * Радар идей: прямой сборщик Apify (supabase/functions/_lib/radarCrawl.ts) —
 * выбор актора и входа по источнику/ссылке, разворачивание ответа актора,
 * оценка расхода. То, что молча ломает сбор: неверный вход актора,
 * потерянные подписчики у постов профиля, неразобранная ссылка.
 */
import { describe, expect, it } from "vitest";
import {
  adLibraryUrl,
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

  it("YouTube-хештег → страница хештега", () => {
    const run = buildSourceRun({ kind: "hashtag", platform: "youtube", handle: "#стоматология", limit: 7 })!;
    expect(run.input).toMatchObject({ startUrls: [{ url: "https://www.youtube.com/hashtag/стоматология" }], maxResults: 7, maxResultsShorts: 7 });
  });

  it("Threads-аккаунт и страница Facebook (ник или ссылка)", () => {
    const th = buildSourceRun({ kind: "competitor_account", platform: "threads", handle: "@clinic" })!;
    expect(th.actor).toBe(APIFY_ACTORS.threads);
    expect(th.input).toMatchObject({ input: [{ url: "https://www.threads.net/@clinic" }], maxThreads: 12 });
    const fb = buildSourceRun({ kind: "competitor_account", platform: "facebook", handle: "clinic.kz" })!;
    expect(fb.actor).toBe(APIFY_ACTORS.facebook);
    expect(fb.input).toMatchObject({ startUrls: [{ url: "https://www.facebook.com/clinic.kz/" }], resultsLimit: 12 });
    const fbUrl = buildSourceRun({ kind: "competitor_account", platform: "facebook", handle: "https://www.facebook.com/profile.php?id=100" })!;
    expect((fbUrl.input.startUrls as { url: string }[])[0].url).toBe("https://www.facebook.com/profile.php?id=100");
  });

  it("Библиотека рекламы: запрос → поисковая ссылка Ad Library, ссылка — как есть, Instagram — только IG", () => {
    const run = buildSourceRun({ kind: "ad_library_query", platform: "facebook", handle: "имплантация зубов", limit: 10 })!;
    expect(run.actor).toBe(APIFY_ACTORS.adLibrary);
    const url = (run.input.startUrls as { url: string }[])[0].url;
    expect(url).toMatch(/^https:\/\/www\.facebook\.com\/ads\/library\/\?/);
    expect(url).toMatch(/q=%D0%B8%D0%BC%D0%BF%D0%BB%D0%B0%D0%BD%D1%82%D0%B0%D1%86%D0%B8%D1%8F\+%D0%B7%D1%83%D0%B1%D0%BE%D0%B2/);
    expect(url).toMatch(/search_type=keyword_unordered/);
    expect(run.input.resultsLimit).toBe(10);
    expect(adLibraryUrl("https://www.facebook.com/ads/library/?id=1", "facebook")).toBe("https://www.facebook.com/ads/library/?id=1");
    expect(adLibraryUrl("виниры", "instagram")).toMatch(/publisher_platforms%5B0%5D=instagram/);
  });

  it("неподдерживаемое: хештеги Threads/Facebook, библиотека рекламы вне Meta, пустой ник", () => {
    expect(crawlUnsupportedReason({ kind: "hashtag", platform: "threads", handle: "a" })).toMatch(/Threads/);
    expect(crawlUnsupportedReason({ kind: "ad_library_query", platform: "tiktok", handle: "a" })).toMatch(/Facebook и Instagram/);
    expect(crawlUnsupportedReason({ kind: "ad_library_query", platform: "facebook", handle: "  " })).toMatch(/пустой запрос/);
    expect(crawlUnsupportedReason({ kind: "competitor_account", platform: "instagram", handle: "@" })).toMatch(/ник/);
    expect(crawlUnsupportedReason({ kind: "competitor_account", platform: "instagram", handle: "ok" })).toBeNull();
    expect(crawlUnsupportedReason({ kind: "competitor_account", platform: "threads", handle: "ok" })).toBeNull();
    expect(buildSourceRun({ kind: "hashtag", platform: "facebook", handle: "a" })).toBeNull();
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
  it("Threads — только ссылка на пост; Facebook — пост страницы или объявление Ad Library", () => {
    expect(buildUrlRun("https://www.threads.net/@a/post/DMx?x=1")!.input).toMatchObject({ input: [{ url: "https://www.threads.net/@a/post/DMx" }], maxThreads: 1 });
    expect(buildUrlRun("https://www.threads.net/@a")).toBeNull();
    expect(buildUrlRun("https://www.facebook.com/clinic/posts/123")!.actor).toBe(APIFY_ACTORS.facebook);
    expect(buildUrlRun("https://www.facebook.com/ads/library/?id=777")!.actor).toBe(APIFY_ACTORS.adLibrary);
  });
  it("мусор → null", () => {
    expect(buildUrlRun("javascript:alert(1)")).toBeNull();
    expect(buildUrlRun("https://vk.com/video1")).toBeNull();
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

  it("Threads: объект GraphQL с like_count / text_post_app_info / user, ссылка из кода поста", () => {
    const [item] = flattenApifyItems("threads", [{
      pk: "3500", code: "DMx", caption: { text: "Три ошибки" }, taken_at: 1756720000,
      like_count: 40, text_post_app_info: { direct_reply_count: 5, repost_count: 2, quote_count: 1 },
      user: { username: "clinic", follower_count: 800 }, video_versions: [{ url: "https://cdn.threads.net/v.mp4" }],
    }]);
    const post = normalizeIngestItem("threads", item)!;
    expect(post.external_id).toBe("3500");
    expect(post.url).toBe("https://www.threads.net/@clinic/post/DMx");
    expect(post.author_handle).toBe("clinic");
    expect(post.metrics).toEqual({ likes: 40, comments: 5, shares: 3, saves: 0, views: 0 });
    expect(post.followers).toBe(800);
    expect(post.video_url).toBe("https://cdn.threads.net/v.mp4");
    expect(post.published_at).toBe(new Date(1756720000 * 1000).toISOString());
  });

  it("Threads: профиль с вложенными постами разворачивается с подписчиками владельца", () => {
    const items = flattenApifyItems("threads", [{ username: "clinic", follower_count: 800, threads: [{ id: "1", text: "a", like_count: 1 }, { id: "2", text: "b" }] }]);
    expect(items).toHaveLength(2);
    expect(normalizeIngestItem("threads", items[1])!.followers).toBe(800);
    expect(normalizeIngestItem("threads", items[1])!.author_handle).toBe("clinic");
  });

  it("Facebook: postId / pageName / time / likes / comments / shares / viewsCount", () => {
    const [item] = flattenApifyItems("facebook", [{
      postId: "9001", url: "https://www.facebook.com/clinic/posts/9001", pageName: "Clinic", text: "Акция", time: "2026-09-01T10:00:00.000Z",
      likes: 12, comments: 3, shares: 1, viewsCount: 500, isVideo: true, media: [{ thumbnail: "https://scontent/t.jpg" }],
    }]);
    const post = normalizeIngestItem("facebook", item)!;
    expect(post.external_id).toBe("9001");
    expect(post.author_handle).toBe("Clinic");
    expect(post.media_type).toBe("video");
    expect(post.metrics).toEqual({ likes: 12, comments: 3, shares: 1, saves: 0, views: 500 });
    expect(post.thumbnail_url).toBe("https://scontent/t.jpg");
  });

  it("Библиотека рекламы: adArchiveID → ссылка на объявление, текст из snapshot, видео и превью, нулевые реакции", () => {
    const [item] = flattenApifyItems("facebook", [{
      adArchiveID: "555", pageName: "Clinic", startDate: 1756720000,
      snapshot: { title: "Имплантация", body: { text: "Скидка 20 %" }, cta_text: "Записаться", page_like_count: 3000,
        videos: [{ video_hd_url: "https://video.fb/v.mp4", video_preview_image_url: "https://video.fb/p.jpg" }] },
    }], undefined, "ad_library_query");
    const post = normalizeIngestItem("facebook", item)!;
    expect(post.external_id).toBe("ad-555");
    expect(post.url).toBe("https://www.facebook.com/ads/library/?id=555");
    expect(post.caption).toBe("Имплантация\n\nСкидка 20 %\n\nЗаписаться");
    expect(post.video_url).toBe("https://video.fb/v.mp4");
    expect(post.thumbnail_url).toBe("https://video.fb/p.jpg");
    expect(post.followers).toBe(3000);
    expect(post.metrics).toEqual({ likes: 0, comments: 0, shares: 0, saves: 0, views: 0 });
    expect(post.media_type).toBe("video");
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
