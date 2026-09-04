/**
 * OAuth площадок и публикаторы TikTok / YouTube: чистая логика из
 * supabase/functions/_lib. Ломается тихо: адреса согласия, разбор токенов,
 * классификация отказов.
 */
import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  codeExchangeRequest,
  hasRequiredScope,
  parseIdentity,
  parseTokenResponse,
  refreshRequest,
  returnUrlWith,
  tokenError,
  tokenNeedsRefresh,
} from "../../supabase/functions/_lib/publishOAuth.ts";
import { classifyTikTokError, pickPrivacyLevel, tiktokPostUrl, tiktokTitle } from "../../supabase/functions/_lib/publishers/tiktok.ts";
import { classifyYouTubeError, youtubeTitle, youtubeUrl } from "../../supabase/functions/_lib/publishers/youtube.ts";
import { readOAuthResult } from "@/lib/publishingClient";

describe("OAuth площадок", () => {
  const p = { clientId: "app", redirectUri: "https://x.supabase.co/functions/v1/publish-oauth/callback/threads", state: "st-1" };

  it("адреса согласия содержат клиента, redirect, scope и state", () => {
    const threads = new URL(authorizeUrl("threads", p));
    expect(threads.hostname).toBe("threads.net");
    expect(threads.searchParams.get("scope")).toContain("threads_content_publish");
    const tiktok = new URL(authorizeUrl("tiktok", p));
    expect(tiktok.searchParams.get("client_key")).toBe("app");
    expect(tiktok.searchParams.get("scope")).toContain("video.publish");
    const yt = new URL(authorizeUrl("youtube", p));
    expect(yt.searchParams.get("access_type")).toBe("offline");
    expect(yt.searchParams.get("scope")).toContain("youtube.upload");
    for (const u of [threads, tiktok, yt]) expect(u.searchParams.get("state")).toBe("st-1");
  });

  it("обмен кода: форма с нужными ключами у каждой площадки", () => {
    const creds = { clientId: "id", clientSecret: "sec", code: "c", redirectUri: "https://r" };
    expect(String(codeExchangeRequest("tiktok", creds).init.body)).toContain("client_key=id");
    expect(String(codeExchangeRequest("youtube", creds).init.body)).toContain("grant_type=authorization_code");
    expect(codeExchangeRequest("threads", creds).url).toContain("graph.threads.net");
    expect(refreshRequest("threads", { clientId: "id", clientSecret: "sec", refreshToken: "tok" }).url).toContain("th_refresh_token");
    expect(String(refreshRequest("tiktok", { clientId: "id", clientSecret: "sec", refreshToken: "r" }).init.body)).toContain("grant_type=refresh_token");
  });

  it("разбор токенов: TikTok кладёт всё в data, YouTube и Threads — в корень", () => {
    const now = Date.parse("2026-09-05T10:00:00Z");
    const tt = parseTokenResponse("tiktok", { data: { access_token: "a", refresh_token: "r", expires_in: 86400, open_id: "o1", scope: "video.publish" } }, now)!;
    expect(tt.externalId).toBe("o1");
    expect(tt.expiresAt).toBe("2026-09-06T10:00:00.000Z");
    const yt = parseTokenResponse("youtube", { access_token: "a", refresh_token: "r", expires_in: 3599, scope: "https://www.googleapis.com/auth/youtube.upload" }, now)!;
    expect(yt.refreshToken).toBe("r");
    const th = parseTokenResponse("threads", { access_token: "a", user_id: 12345 }, now)!;
    expect(th.externalId).toBe("12345");
    expect(parseTokenResponse("threads", { error: { message: "bad" } })).toBeNull();
  });

  it("ошибки токен-эндпоинта и проверка scope", () => {
    expect(tokenError({ error: "invalid_grant", error_description: "expired" })).toBe("invalid_grant: expired");
    expect(tokenError({ error: { code: "ok" }, data: {} })).toBeNull();
    expect(tokenError({ error: { code: "access_denied", message: "no" } })).toBe("access_denied: no");
    expect(hasRequiredScope("tiktok", "user.info.basic,video.publish")).toBe(true);
    expect(hasRequiredScope("tiktok", "user.info.basic")).toBe(false);
    expect(hasRequiredScope("youtube", null)).toBe(true);
  });

  it("идентичность аккаунта по площадке", () => {
    expect(parseIdentity("threads", { id: "1", username: "brand", name: "Brand" })).toEqual({ externalId: "1", name: "Brand", handle: "brand" });
    expect(parseIdentity("tiktok", { data: { user: { open_id: "o", display_name: "D", username: "u" } } })).toEqual({ externalId: "o", name: "D", handle: "u" });
    expect(parseIdentity("youtube", { items: [{ id: "UC1", snippet: { title: "Ch", customUrl: "@ch" } }] })).toEqual({ externalId: "UC1", name: "Ch", handle: "@ch" });
    expect(parseIdentity("youtube", { items: [] })).toBeNull();
  });

  it("обновление за 10 минут до истечения; возврат с параметрами", () => {
    const now = Date.parse("2026-09-05T10:00:00Z");
    expect(tokenNeedsRefresh("2026-09-05T10:05:00Z", now)).toBe(true);
    expect(tokenNeedsRefresh("2026-09-05T12:00:00Z", now)).toBe(false);
    expect(tokenNeedsRefresh(null, now)).toBe(false);
    const back = returnUrlWith("https://app/marketing/publishing?tab=1", { publish_connected: "tiktok", account: "Юра" });
    expect(back).toContain("tab=1");
    expect(back).toContain("publish_connected=tiktok");
    expect(readOAuthResult("?publish_connected=tiktok&account=%D0%AE%D1%80%D0%B0")).toEqual({ connected: { platform: "tiktok", account: "Юра" } });
    expect(readOAuthResult("?publish_error=denied")).toEqual({ error: "denied" });
    expect(readOAuthResult("?tab=1")).toBeNull();
  });
});

describe("TikTok publisher", () => {
  it("классификация отказов", () => {
    expect(classifyTikTokError("access_token_invalid").kind).toBe("token");
    expect(classifyTikTokError("spam_risk_too_many_posts").kind).toBe("limit");
    expect(classifyTikTokError("internal_error").kind).toBe("temporary");
    expect(classifyTikTokError("url_ownership_unverified").kind).toBe("fatal");
  });
  it("уровень приватности: публичный, если доступен", () => {
    expect(pickPrivacyLevel(["SELF_ONLY", "PUBLIC_TO_EVERYONE"])).toBe("PUBLIC_TO_EVERYONE");
    expect(pickPrivacyLevel(["SELF_ONLY"])).toBe("SELF_ONLY");
    expect(pickPrivacyLevel(undefined)).toBe("PUBLIC_TO_EVERYONE");
  });
  it("заголовок и ссылка", () => {
    expect(tiktokTitle("x".repeat(3000)).length).toBeLessThanOrEqual(2200);
    expect(tiktokPostUrl("@brand", "123")).toBe("https://www.tiktok.com/@brand/video/123");
    expect(tiktokPostUrl(null, null)).toBeNull();
  });
});

describe("YouTube publisher", () => {
  it("классификация отказов Google API", () => {
    expect(classifyYouTubeError(401, { error: { message: "Invalid Credentials" } }).kind).toBe("token");
    expect(classifyYouTubeError(403, { error: { errors: [{ reason: "quotaExceeded" }], message: "quota" } }).kind).toBe("limit");
    expect(classifyYouTubeError(403, { error: { errors: [{ reason: "uploadLimitExceeded" }] } }).kind).toBe("limit");
    expect(classifyYouTubeError(503, { error: { message: "backend" } }).kind).toBe("temporary");
    expect(classifyYouTubeError(400, { error: { errors: [{ reason: "invalidTitle" }] } }).kind).toBe("fatal");
  });
  it("заголовок: из title, иначе первая строка подписи, ≤100", () => {
    expect(youtubeTitle(null, "Первая строка\nвторая")).toBe("Первая строка");
    expect(youtubeTitle("x".repeat(150), "c").length).toBeLessThanOrEqual(100);
    expect(youtubeTitle("<b>Т</b>", "c")).toBe("bТ/b");
    expect(youtubeUrl("abc")).toBe("https://www.youtube.com/shorts/abc");
  });
});
