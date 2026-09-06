import type { SocialConnector } from "./types.ts";
import { callJson } from "./http.ts";
import { publishTikTok } from "../publishers/tiktok.ts";
import { resolveCapabilities } from "../publishCapabilities.ts";
import { metricsScopeMissing } from "../publishMetricsCore.ts";

const API = "https://open.tiktokapis.com/v2";

export const tiktokConnector: SocialConnector = {
  platform: "tiktok",
  publish: publishTikTok,
  capabilities: ({ account }) =>
    resolveCapabilities({ platform: "tiktok", tokenKind: "oauth", oauthScope: account.oauth_scope ?? null, hasRefreshToken: Boolean(account.refresh_token_encrypted) }),
  async getPublication({ account, token, externalPostId }) {
    // Без scope video.list площадка не отдаёт список видео — проверить нечем.
    if (metricsScopeMissing("tiktok", account.oauth_scope)) {
      return { exists: null, reason: "нет scope video.list — пост прочитать нельзя, нужен reconnect с этим правом", retryable: false };
    }
    // Внутренний publish_id (v_pub_…) — не id поста: публикатор не получил
    // publicaly_available_post_id, значит подтвердить публикацию нечем.
    if (/^v_pub_/i.test(externalPostId)) {
      return { exists: null, reason: "площадка не вернула публичный id поста", retryable: false };
    }
    const r = await callJson(`${API}/video/query/?fields=id,share_url,create_time`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ filters: { video_ids: [externalPostId] } }),
    });
    if (r.networkError) return { exists: null, reason: `сеть: ${r.networkError}`, retryable: true };
    const body = (r.body ?? {}) as { error?: { code?: string; message?: string }; data?: { videos?: { id?: string; share_url?: string }[] } };
    const code = body.error?.code;
    if (code && code !== "ok") {
      const dead = /access_token_invalid|invalid_token|scope_not_authorized|token_expired/i.test(code);
      return { exists: null, reason: `TikTok ${code}: ${body.error?.message ?? ""}`.trim(), retryable: !dead, raw: r.body };
    }
    const video = (body.data?.videos ?? []).find((v) => String(v.id) === String(externalPostId));
    if (!video) return { exists: false, reason: "видео не найдено в списке аккаунта", raw: r.body };
    return { exists: true, url: video.share_url ?? null, raw: r.body };
  },
};
