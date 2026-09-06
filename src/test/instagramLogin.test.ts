/**
 * Instagram Login (вход логином самого Instagram) — чистая часть входа:
 * адрес согласия, обмен кода, разбор ответов площадки.
 *
 * Ломается тихо: неверный scope или необрезанный «#_» в коде дают
 * «Invalid authorization code» уже после того, как человек ввёл пароль.
 */
import { describe, expect, it } from "vitest";
import {
  cleanInstagramCode,
  hasInstagramPublishScope,
  instagramLoginAuthorizeUrl,
  instagramLoginCodeExchangeRequest,
  instagramLongLivedUrl,
  instagramMeUrl,
  INSTAGRAM_LOGIN_SCOPES,
  parseInstagramLoginToken,
  parseInstagramProfile,
} from "../../supabase/functions/_lib/publishOAuth.ts";

const redirectUri = "https://x.supabase.co/functions/v1/publish-oauth/callback/instagram-login";

describe("Instagram Login: адрес согласия", () => {
  it("ведёт на instagram.com и просит право на публикацию", () => {
    const u = new URL(instagramLoginAuthorizeUrl({ clientId: "ig-app", redirectUri, state: "st-1" }));
    expect(u.hostname).toBe("www.instagram.com");
    expect(u.pathname).toBe("/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("ig-app");
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(u.searchParams.get("state")).toBe("st-1");
    expect(u.searchParams.get("scope")).toContain("instagram_business_content_publish");
    expect(u.searchParams.get("scope")).toBe(INSTAGRAM_LOGIN_SCOPES);
  });

  it("адрес возврата отличается от входа через Facebook — приложения разные", () => {
    const u = new URL(instagramLoginAuthorizeUrl({ clientId: "ig-app", redirectUri, state: "st-1" }));
    expect(u.searchParams.get("redirect_uri")).toContain("callback/instagram-login");
  });
});

describe("Instagram Login: обмен кода", () => {
  it("шлёт форму на api.instagram.com и режет хвост #_ у кода", () => {
    const r = instagramLoginCodeExchangeRequest({ clientId: "ig-app", clientSecret: "sec", code: "AQB123#_", redirectUri });
    expect(r.url).toBe("https://api.instagram.com/oauth/access_token");
    expect(r.init.method).toBe("POST");
    const body = new URLSearchParams(String(r.init.body));
    expect(body.get("code")).toBe("AQB123");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(redirectUri);
  });

  it("cleanInstagramCode трогает только хвост", () => {
    expect(cleanInstagramCode("AQ#_B#_")).toBe("AQ#_B");
    expect(cleanInstagramCode("AQB")).toBe("AQB");
  });

  it("долгий токен просят у graph.instagram.com обменом ig_exchange_token", () => {
    const u = new URL(instagramLongLivedUrl({ clientSecret: "sec", shortToken: "IGAAshort" }));
    expect(u.hostname).toBe("graph.instagram.com");
    expect(u.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(u.searchParams.get("access_token")).toBe("IGAAshort");
  });
});

describe("Instagram Login: разбор ответов", () => {
  it("права приезжают массивом permissions — приводим к строке", () => {
    const t = parseInstagramLoginToken(
      { access_token: "IGAAx", user_id: 178414, permissions: ["instagram_business_basic", "instagram_business_content_publish"], expires_in: 5184000 },
      Date.parse("2026-09-06T00:00:00Z"),
    );
    expect(t?.accessToken).toBe("IGAAx");
    expect(t?.userId).toBe("178414");
    expect(t?.scope).toContain("instagram_business_content_publish");
    expect(t?.expiresAt).toBe("2026-11-05T00:00:00.000Z");
  });

  it("ответ без токена — null, а не пустая строка", () => {
    expect(parseInstagramLoginToken({ error_type: "OAuthException" })).toBeNull();
  });

  it("профиль читается из user_id, а не id", () => {
    const p = parseInstagramProfile({ user_id: "17841", username: "clinic", name: "Клиника", followers_count: 628, account_type: "BUSINESS" });
    expect(p).toEqual({ externalId: "17841", username: "clinic", name: "Клиника", avatarUrl: null, followers: 628, accountType: "BUSINESS" });
  });

  it("адрес профиля просит подписчиков и тип аккаунта — по ним видно, можно ли публиковать", () => {
    const u = new URL(instagramMeUrl("IGAAx"));
    expect(u.searchParams.get("fields")).toContain("followers_count");
    expect(u.searchParams.get("fields")).toContain("account_type");
  });

  it("без права на публикацию вход считаем неудачным, пустой scope — пропускаем", () => {
    expect(hasInstagramPublishScope("instagram_business_basic")).toBe(false);
    expect(hasInstagramPublishScope("instagram_business_basic,instagram_business_content_publish")).toBe(true);
    expect(hasInstagramPublishScope(null)).toBe(true);
  });
});
