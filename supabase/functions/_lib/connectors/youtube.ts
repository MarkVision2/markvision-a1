import type { SocialConnector } from "./types.ts";
import { callJson } from "./http.ts";
import { publishYouTube, youtubeUrl } from "../publishers/youtube.ts";
import { resolveCapabilities } from "../publishCapabilities.ts";

const API = "https://www.googleapis.com/youtube/v3";

export const youtubeConnector: SocialConnector = {
  platform: "youtube",
  publish: publishYouTube,
  capabilities: ({ account }) =>
    resolveCapabilities({ platform: "youtube", tokenKind: "oauth", oauthScope: account.oauth_scope ?? null, hasRefreshToken: Boolean(account.refresh_token_encrypted) }),
  async getPublication({ token, externalPostId }) {
    const r = await callJson(`${API}/videos?part=status,snippet&id=${encodeURIComponent(externalPostId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.networkError) return { exists: null, reason: `сеть: ${r.networkError}`, retryable: true };
    const body = (r.body ?? {}) as { error?: { message?: string }; items?: { id?: string; status?: { uploadStatus?: string; privacyStatus?: string } }[] };
    if (!r.ok || body.error) {
      const retryable = !(r.status === 401 || r.status === 403);
      return { exists: null, reason: `YouTube HTTP ${r.status}: ${body.error?.message ?? ""}`.trim(), retryable, raw: r.body };
    }
    const item = (body.items ?? [])[0];
    if (!item?.id) return { exists: false, reason: "видео не найдено", raw: r.body };
    const st = item.status ?? {};
    // uploaded/processed — видео есть; rejected/failed/deleted — площадка его не приняла.
    if (st.uploadStatus && /rejected|failed|deleted/i.test(st.uploadStatus)) {
      return { exists: false, reason: `YouTube uploadStatus=${st.uploadStatus}`, raw: r.body };
    }
    return { exists: true, url: youtubeUrl(item.id), platformStatus: `${st.uploadStatus ?? ""}/${st.privacyStatus ?? ""}`, raw: r.body };
  },
};
