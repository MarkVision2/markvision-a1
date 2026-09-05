import type { SocialConnector } from "./types.ts";
import { callJson, graphError, instagramGraph } from "./http.ts";
import { publishInstagram } from "../publishers/instagram.ts";
import { resolveCapabilities, tokenKindOf } from "../publishCapabilities.ts";

/** Коды Graph, означающие «объекта нет / нет доступа к нему», а не сбой. */
const NOT_FOUND_CODES = new Set([100, 803]);

export const instagramConnector: SocialConnector = {
  platform: "instagram",
  publish: publishInstagram,
  capabilities: ({ account, token }) =>
    resolveCapabilities({ platform: "instagram", tokenKind: tokenKindOf(token), oauthScope: account.oauth_scope ?? null }),
  async getPublication({ token, externalPostId }) {
    const graph = instagramGraph(token);
    const r = await callJson(`${graph}/${encodeURIComponent(externalPostId)}?fields=id,permalink,media_type,timestamp&access_token=${encodeURIComponent(token)}`);
    if (r.networkError) return { exists: null, reason: `сеть: ${r.networkError}`, retryable: true };
    const err = graphError(r.body);
    if (err) {
      if (NOT_FOUND_CODES.has(err.code) || /does not exist|unsupported get request/i.test(err.message)) {
        return { exists: false, reason: err.message, raw: r.body };
      }
      const retryable = !(err.code === 190 || err.code === 102 || err.code === 10 || err.code === 200);
      return { exists: null, reason: `Graph ${err.code}: ${err.message}`, retryable, raw: r.body };
    }
    const b = (r.body ?? {}) as { id?: string; permalink?: string };
    if (!b.id) return { exists: null, reason: "площадка ответила без id", retryable: true, raw: r.body };
    return { exists: true, url: b.permalink ?? null, raw: r.body };
  },
};
