/**
 * Радар идей: чистая логика supabase/functions/_lib/radar.ts и классификация
 * отказов Threads. То, что ломается тихо: нормализация чужих форматов,
 * разбор ответа модели, превращение разбора в идею.
 */
import { describe, expect, it } from "vitest";
import {
  buildAnalysisPrompt,
  estimateAnalysisCostUsd,
  IDEA_SCORE_THRESHOLD,
  ideaFromAnalysis,
  normalizeIngestItem,
  parseAnalysis,
  transcribableVideoUrl,
} from "../../supabase/functions/_lib/radar.ts";
import { classifyThreadsError, threadsText, THREADS_TEXT_LIMIT } from "../../supabase/functions/_lib/publishers/threads.ts";

describe("normalizeIngestItem", () => {
  it("Apify instagram-scraper: shortCode, likesCount, ownerUsername, displayUrl", () => {
    const item = normalizeIngestItem("instagram", {
      shortCode: "C1abc",
      url: "https://www.instagram.com/p/C1abc/",
      ownerUsername: "clinic",
      timestamp: "2026-09-01T10:00:00.000Z",
      type: "Video",
      caption: "Три ошибки при отбеливании",
      videoUrl: "https://scontent.cdninstagram.com/v.mp4",
      displayUrl: "https://scontent.cdninstagram.com/t.jpg",
      likesCount: "1 200",
      commentsCount: 45,
      videoViewCount: 30000,
      ownerFollowersCount: 25000,
    });
    expect(item).not.toBeNull();
    expect(item!.external_id).toBe("C1abc");
    expect(item!.author_handle).toBe("clinic");
    expect(item!.media_type).toBe("video");
    expect(item!.metrics).toEqual({ likes: 1200, comments: 45, shares: 0, saves: 0, views: 30000 });
    expect(item!.followers).toBe(25000);
    expect(item!.published_at).toBe("2026-09-01T10:00:00.000Z");
  });

  it("TikTok (clockworks): id, stats.diggCount, authorMeta, createTime в секундах", () => {
    const item = normalizeIngestItem("tiktok", {
      id: "7300000000000000000",
      webVideoUrl: "https://www.tiktok.com/@a/video/7300000000000000000",
      text: "хук",
      createTime: 1756720000,
      authorMeta: { name: "author", fans: 5000 },
      stats: { diggCount: 10, commentCount: 2, shareCount: 3, collectCount: 4, playCount: 999 },
      videoMeta: { downloadAddr: "https://v16.tiktokcdn.com/x.mp4", coverUrl: "https://p16.tiktokcdn.com/c.jpg" },
    });
    expect(item!.external_id).toBe("7300000000000000000");
    expect(item!.author_handle).toBe("author");
    expect(item!.metrics).toEqual({ likes: 10, comments: 2, shares: 3, saves: 4, views: 999 });
    expect(item!.followers).toBe(5000);
    expect(item!.published_at).toBe(new Date(1756720000 * 1000).toISOString());
    expect(item!.video_url).toBe("https://v16.tiktokcdn.com/x.mp4");
  });

  it("id из ссылки, если провайдер не дал; неизвестная площадка и пустой элемент → null", () => {
    const item = normalizeIngestItem("instagram", { url: "https://www.instagram.com/reel/XYZ123/?igsh=1" });
    expect(item!.external_id).toBe("XYZ123");
    expect(normalizeIngestItem("vk", { id: "1" })).toBeNull();
    expect(normalizeIngestItem("instagram", {})).toBeNull();
  });

  it("уже нормализованный элемент (metrics объектом) проходит без потерь", () => {
    const item = normalizeIngestItem("instagram", {
      external_id: "p1", url: null, metrics: { likes: 5, comments: 1, shares: 0, saves: 2, views: 100 }, followers: null, transcript: "текст",
    });
    expect(item!.metrics.saves).toBe(2);
    expect(item!.followers).toBeNull();
    expect(item!.transcript).toBe("текст");
  });
});

describe("разбор поста", () => {
  it("промпт содержит метрики, транскрипт и запрет копирования", () => {
    const p = buildAnalysisPrompt({
      platform: "instagram", caption: "подпись", transcript: "речь",
      metrics: { likes: 1, comments: 2, shares: 3, saves: 4, views: 5 }, followers: 100, ownNiche: "стоматология",
    });
    expect(p.system).toMatch(/Не копируй/);
    // Модель должна видеть имена полей — иначе отвечает произвольной структурой.
    for (const key of ["hook", "niche", "structure", "triggers", "why_it_works", "score", "idea_title", "idea_angle", "script_outline"]) {
      expect(p.system).toContain(`"${key}"`);
    }
    expect(p.user).toMatch(/лайки 1, комментарии 2, репосты 3, сохранения 4, просмотры 5/);
    expect(p.user).toMatch(/стоматология/);
    expect(p.user).toMatch(/речь/);
    expect(buildAnalysisPrompt({ platform: "tiktok", caption: null, transcript: null, metrics: { likes: 0, comments: 0, shares: 0, saves: 0, views: 0 }, followers: null }).user).toMatch(/Транскрипта нет/);
  });

  const good = {
    hook: "Вы чистите зубы неправильно",
    niche: "стоматология",
    structure: { problem: "налёт", solution: "техника", cta: "запишись" },
    triggers: ["страх", "любопытство"],
    why_it_works: "бьёт в боль",
    score: 82,
    idea_title: "Три ошибки чистки",
    idea_angle: "для родителей",
    script_outline: "хук → 3 ошибки → CTA",
  };

  it("принимает JSON строкой, с обвязкой и объектом; режет score в 0..100", () => {
    expect(parseAnalysis(JSON.stringify(good))?.score).toBe(82);
    expect(parseAnalysis("```json\n" + JSON.stringify({ ...good, score: 140 }) + "\n```")?.score).toBe(100);
    expect(parseAnalysis({ ...good, triggers: "нет" })?.triggers).toEqual([]);
    expect(parseAnalysis({ ...good, hook: "" })).toBeNull();
    expect(parseAnalysis("мусор")).toBeNull();
    expect(parseAnalysis({ analysis: good })?.idea_title).toBe("Три ошибки чистки");
  });

  it("идея из разбора: средняя оценка поста и модели, структура с триггерами", () => {
    const a = parseAnalysis(good)!;
    const idea = ideaFromAnalysis("post-1", a, 60);
    expect(idea.title).toBe("Три ошибки чистки");
    expect(idea.score).toBe(71);
    expect(idea.source_post_ids).toEqual(["post-1"]);
    expect(idea.structure).toMatchObject({ problem: "налёт", triggers: ["страх", "любопытство"] });
    expect(IDEA_SCORE_THRESHOLD).toBeGreaterThan(0);
  });

  it("видео для Whisper: только https и не приватные хосты", () => {
    expect(transcribableVideoUrl("https://v16.tiktokcdn.com/x.mp4")).toBeTruthy();
    expect(transcribableVideoUrl("http://cdn/x.mp4")).toBeNull();
    expect(transcribableVideoUrl("https://127.0.0.1/x.mp4")).toBeNull();
    expect(transcribableVideoUrl("https://worker.internal/x.mp4")).toBeNull();
    expect(transcribableVideoUrl(null)).toBeNull();
  });

  it("стоимость разбора: минута Whisper ≈ $0.006", () => {
    expect(estimateAnalysisCostUsd(60, 2000)).toBeGreaterThan(0.006);
    expect(estimateAnalysisCostUsd(60, 2000)).toBeLessThan(0.01);
    expect(estimateAnalysisCostUsd(null, 2000)).toBeLessThan(0.002);
  });
});

describe("Threads publisher", () => {
  it("классификация отказов: токен, лимит, временный, фатальный", () => {
    expect(classifyThreadsError({ code: 190, message: "Invalid OAuth access token" }).kind).toBe("token");
    expect(classifyThreadsError({ code: 4, message: "Application request limit reached" }).kind).toBe("limit");
    expect(classifyThreadsError({ code: 999, message: "publishing limit reached" }).kind).toBe("limit");
    expect(classifyThreadsError({ code: 2, message: "Service temporarily unavailable" }).kind).toBe("temporary");
    expect(classifyThreadsError({ code: 100, message: "Unsupported video format" }).kind).toBe("fatal");
  });

  it("текст режется по лимиту 500 по границе слова", () => {
    const long = Array.from({ length: 120 }, (_, i) => `слово${i}`).join(" ");
    const t = threadsText(long);
    expect(t.length).toBeLessThanOrEqual(THREADS_TEXT_LIMIT);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/слово\d*…$/.test(t) ? /$^/ : /\s…$/);
    expect(threadsText("короткий текст")).toBe("короткий текст");
  });
});
