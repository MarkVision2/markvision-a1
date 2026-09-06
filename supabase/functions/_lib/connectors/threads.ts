import type { SocialConnector } from "./types.ts";
import { callJson, graphError } from "./http.ts";
import { publishThreads } from "../publishers/threads.ts";
import { resolveCapabilities } from "../publishCapabilities.ts";

const GRAPH = "https://graph.threads.net/v1.0";

export const threadsConnector: SocialConnector = {
  platform: "threads",
  publish: publishThreads,
  capabilities: ({ account }) => resolveCapabilities({ platform: "threads", tokenKind: "oauth", oauthScope: account.oauth_scope ?? null }),
  async getPublication({ token, externalPostId }) {
    const r = await callJson(`${GRAPH}/${encodeURIComponent(externalPostId)}?fields=id,permalink,timestamp,media_type&access_token=${encodeURIComponent(token)}`);
    if (r.networkError) return { exists: null, reason: `сеть: ${r.networkError}`, retryable: true };
    const err = graphError(r.body);
    if (err) {
      if (err.code === 100 || /does not exist|unsupported get request/i.test(err.message)) return { exists: false, reason: err.message, raw: r.body };
      const retryable = !(err.code === 190 || err.code === 102 || err.code === 10);
      return { exists: null, reason: `Threads ${err.code}: ${err.message}`, retryable, raw: r.body };
    }
    const b = (r.body ?? {}) as { id?: string; permalink?: string };
    if (!b.id) return { exists: null, reason: "площадка ответила без id", retryable: true, raw: r.body };
    return { exists: true, url: b.permalink ?? null, raw: r.body };
  },
};
