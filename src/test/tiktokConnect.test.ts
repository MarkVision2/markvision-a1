/**
 * Раздел «Подключение TikTok»: чистая логика TikTok API (scopes, поля
 * профиля, план загрузки, проверка формы публикации по UX-гайду площадки)
 * и помощники интерфейса. Ломается тихо, поэтому закреплено тестами.
 */
import { describe, expect, it } from "vitest";
import {
  apiError,
  buildPostInfo,
  consentText,
  contentRange,
  type CreatorInfo,
  DEFAULT_TIKTOK_SCOPE,
  explainError,
  hasScope,
  initRequest,
  isSandboxClientKey,
  MAX_CHUNK,
  parseCreatorInfo,
  parsePublishStatus,
  parseUserInfo,
  parseVideoList,
  type PostForm,
  splitScopes,
  TIKTOK_SCOPES,
  uploadPlan,
  userInfoFields,
  videoListRequest,
} from "../../supabase/functions/_lib/tiktokApi.ts";
import { authorizeUrl, SCOPES } from "../../supabase/functions/_lib/publishOAuth.ts";
import { LEGAL_DOCS, splitBody } from "@/data/legalContent";
import { emptyPostForm, isFinalStage, scopeGranted, scopesByProduct, stageProgress, t } from "@/lib/tiktokClient";

const creator: CreatorInfo = {
  nickname: "MarkVision",
  username: "markvision",
  avatar_url: null,
  privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  comment_disabled: false,
  duet_disabled: true,
  stitch_disabled: false,
  max_video_post_duration_sec: 600,
};

const form = (p: Partial<PostForm> = {}): PostForm => ({ ...emptyPostForm(), title: "Тест #markvision", privacy_level: "PUBLIC_TO_EVERYONE", ...p });

describe("scopes TikTok", () => {
  it("каталог покрывает три продукта и попадает в OAuth", () => {
    const products = new Set(TIKTOK_SCOPES.map((s) => s.product));
    expect([...products].sort()).toEqual(["content_posting_api", "display_api", "login_kit"]);
    expect(SCOPES.tiktok).toBe(DEFAULT_TIKTOK_SCOPE);
    const u = new URL(authorizeUrl("tiktok", { clientId: "sbawx", redirectUri: "https://x/cb", state: "s" }));
    expect(u.searchParams.get("scope")).toContain("user.info.basic");
    expect(u.searchParams.get("scope")).toContain("video.publish");
    expect(u.searchParams.get("scope")).toContain("video.list");
  });

  it("переопределение scope из секрета TIKTOK_SCOPES", () => {
    const u = new URL(authorizeUrl("tiktok", { clientId: "sbawx", redirectUri: "https://x/cb", state: "s", scope: "user.info.basic,video.publish" }));
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.publish");
  });

  it("разбор и проверка прав", () => {
    expect(splitScopes("user.info.basic,video.list video.publish")).toEqual(["user.info.basic", "video.list", "video.publish"]);
    expect(hasScope("user.info.basic,video.list", "video.list")).toBe(true);
    expect(hasScope(null, "video.list")).toBe(false);
    expect(scopeGranted({ granted_scopes: [] }, "video.publish")).toBe(true); // старый аккаунт без scope
    expect(scopeGranted({ granted_scopes: ["user.info.basic"] }, "video.publish")).toBe(false);
    expect(scopeGranted(null, "user.info.basic")).toBe(false);
  });

  it("поля user/info строго по выданным правам", () => {
    expect(userInfoFields("user.info.basic")).not.toContain("username");
    expect(userInfoFields("user.info.basic,user.info.profile")).toContain("username");
    expect(userInfoFields("user.info.basic,user.info.profile,user.info.stats")).toContain("follower_count");
    expect(userInfoFields(null)).toContain("open_id");
  });

  it("песочница по префиксу ключа", () => {
    expect(isSandboxClientKey("sbaw123")).toBe(true);
    expect(isSandboxClientKey("aw123")).toBe(false);
    expect(isSandboxClientKey("")).toBe(false);
  });

  it("группировка по продуктам в порядке демонстрации", () => {
    expect(scopesByProduct().map((g) => g.product)).toEqual(["login_kit", "display_api", "content_posting_api"]);
  });
});

describe("Display API", () => {
  it("разбор профиля", () => {
    const u = parseUserInfo({ data: { user: { open_id: "o1", display_name: "MV", username: "mv", follower_count: "12", is_verified: false, avatar_url: "a", avatar_large_url: "L" } } })!;
    expect(u.open_id).toBe("o1");
    expect(u.username).toBe("mv");
    expect(u.follower_count).toBe(12);
    expect(u.avatar_url).toBe("L");
    expect(parseUserInfo({ error: { code: "scope_not_authorized" } })).toBeNull();
  });

  it("список видео: запрос и разбор", () => {
    const rq = videoListRequest("tok", { cursor: 123, maxCount: 50 });
    expect(rq.url).toContain("/v2/video/list/?fields=");
    expect(JSON.parse(String(rq.init.body))).toEqual({ max_count: 20, cursor: 123 });
    const list = parseVideoList({ data: { videos: [{ id: 1, title: "A", view_count: 5, cover_image_url: "c" }, { title: "без id" }], cursor: 456, has_more: true } });
    expect(list.videos).toHaveLength(1);
    expect(list.videos[0]).toMatchObject({ id: "1", title: "A", view_count: 5, like_count: 0 });
    expect(list.cursor).toBe(456);
    expect(list.hasMore).toBe(true);
    expect(parseVideoList({}).videos).toEqual([]);
  });
});

describe("Content Posting API", () => {
  it("creator_info", () => {
    const c = parseCreatorInfo({ data: { creator_nickname: "N", creator_username: "u", privacy_level_options: ["SELF_ONLY"], comment_disabled: true, max_video_post_duration_sec: 300 } })!;
    expect(c.nickname).toBe("N");
    expect(c.privacy_level_options).toEqual(["SELF_ONLY"]);
    expect(c.comment_disabled).toBe(true);
    expect(parseCreatorInfo({ data: {} })).toBeNull();
  });

  it("форма: приватность обязательна, выключенные автором взаимодействия не включить", () => {
    expect(buildPostInfo(form({ privacy_level: null }), creator)).toMatchObject({ ok: false });
    const r = buildPostInfo(form({ allow_duet: true, allow_comment: false }), creator);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.postInfo.disable_duet).toBe(true); // у автора дуэты выключены
      expect(r.postInfo.disable_comment).toBe(true);
      expect(r.postInfo.disable_stitch).toBe(false);
      expect(r.postInfo.brand_content_toggle).toBe(false);
      expect(r.postInfo.brand_organic_toggle).toBe(false);
    }
  });

  it("форма: коммерческий контент", () => {
    expect(buildPostInfo(form({ commercial_content: true }), creator)).toMatchObject({ ok: false });
    const branded = buildPostInfo(form({ commercial_content: true, branded_content: true, privacy_level: "SELF_ONLY" }), creator);
    expect(branded.ok).toBe(false);
    const ok = buildPostInfo(form({ commercial_content: true, your_brand: true, branded_content: true }), creator);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.postInfo.brand_content_toggle).toBe(true);
      expect(ok.postInfo.brand_organic_toggle).toBe(true);
    }
    expect(consentText({ commercial_content: true, branded_content: true }, "en")).toContain("Branded Content Policy");
    expect(consentText({ commercial_content: false, branded_content: false }, "ru")).not.toContain("брендированного");
  });

  it("форма: недоступный уровень приватности и длина заголовка", () => {
    expect(buildPostInfo(form({ privacy_level: "FOLLOWER_OF_CREATOR" }), creator)).toMatchObject({ ok: false });
    expect(buildPostInfo(form({ title: "x".repeat(2201) }), creator)).toMatchObject({ ok: false });
    const r = buildPostInfo(form({ ai_generated: true }), creator);
    expect(r.ok && r.postInfo.is_aigc).toBe(true);
  });

  it("план загрузки: один чанк до 64 МБ, дальше — кратные чанки с остатком в последнем", () => {
    const small = uploadPlan(3 * 1024 * 1024);
    expect(small).toMatchObject({ total_chunk_count: 1, chunk_size: 3 * 1024 * 1024 });
    expect(contentRange(small.ranges[0], small.video_size)).toBe(`bytes 0-${3 * 1024 * 1024 - 1}/${3 * 1024 * 1024}`);
    const edge = uploadPlan(MAX_CHUNK);
    expect(edge.total_chunk_count).toBe(1);
    const big = uploadPlan(150 * 1024 * 1024);
    expect(big.chunk_size).toBe(20 * 1024 * 1024);
    expect(big.total_chunk_count).toBe(7);
    expect(big.ranges[6][1]).toBe(150 * 1024 * 1024 - 1);
    expect(big.ranges.reduce((s, [a, b]) => s + (b - a + 1), 0)).toBe(150 * 1024 * 1024);
    expect(() => uploadPlan(0)).toThrow();
  });

  it("init: direct с post_info, inbox — только source_info", () => {
    const plan = uploadPlan(1000);
    const direct = initRequest("t", { mode: "direct", postInfo: buildPostInfo(form(), creator).ok ? (buildPostInfo(form(), creator) as { ok: true; postInfo: never }).postInfo : undefined, source: { kind: "file", plan } });
    expect(direct.url).toContain("/post/publish/video/init/");
    const body = JSON.parse(String(direct.init.body));
    expect(body.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(body.source_info).toEqual({ source: "FILE_UPLOAD", video_size: 1000, chunk_size: 1000, total_chunk_count: 1 });
    const inbox = initRequest("t", { mode: "inbox", source: { kind: "url", videoUrl: "https://v/x.mp4" } });
    expect(inbox.url).toContain("/post/publish/inbox/video/init/");
    expect(JSON.parse(String(inbox.init.body))).toEqual({ source_info: { source: "PULL_FROM_URL", video_url: "https://v/x.mp4" } });
  });

  it("статус публикации и ошибки", () => {
    const st = parsePublishStatus({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7391234567890] } });
    expect(st.status).toBe("PUBLISH_COMPLETE");
    expect(st.post_ids).toEqual(["7391234567890"]);
    expect(parsePublishStatus({ data: { status: "WHATEVER" } }).status).toBe("UNKNOWN");
    expect(isFinalStage("SEND_TO_USER_INBOX")).toBe(true);
    expect(isFinalStage("PROCESSING_UPLOAD")).toBe(false);
    expect(stageProgress("PUBLISH_COMPLETE")).toBe(100);
    expect(apiError({ error: { code: "ok" } })).toBeNull();
    expect(apiError({ error: { code: "url_ownership_unverified", message: "m" } })).toEqual({ code: "url_ownership_unverified", message: "m" });
    expect(explainError("url_ownership_unverified", "en")).toContain("verified");
    expect(explainError("something_new")).toBe("something_new");
  });
});

describe("словарь и юридические страницы", () => {
  it("каждая строка есть на обоих языках", () => {
    expect(t("continueWithTikTok", "en")).toBe("Continue with TikTok");
    expect(t("continueWithTikTok", "ru")).toBe("Продолжить с TikTok");
  });

  it("условия и политика — на двух языках, с разделом о TikTok и одинаковыми якорями", () => {
    for (const doc of ["terms", "privacy"] as const) {
      const ru = LEGAL_DOCS[doc].ru;
      const en = LEGAL_DOCS[doc].en;
      expect(ru.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id));
      expect(ru.sections.length).toBeGreaterThanOrEqual(12);
    }
    expect(LEGAL_DOCS.privacy.en.sections.some((s) => s.id === "tiktok" && s.body.join(" ").includes("Login Kit"))).toBe(true);
    expect(splitBody(["- a", "b"])).toEqual([{ kind: "li", text: "a" }, { kind: "p", text: "b" }]);
  });
});
