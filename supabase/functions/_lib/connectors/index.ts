/**
 * Реестр коннекторов. connectorFor(account) — единственная точка, где ядро
 * выбирает площадку; здесь же живёт (пока единственный) исполнитель —
 * официальный API. Device / human исполнители подключаются сюда же, когда
 * появятся (Execution Router, docs/ARCHITECTURE.md, Phase 3).
 */
import type { PublishAccount } from "../publishCore.ts";
import type { PublishOutcome, PublishRequest } from "../publishers/types.ts";
import type { SocialConnector } from "./types.ts";
import { instagramConnector } from "./instagram.ts";
import { threadsConnector } from "./threads.ts";
import { tiktokConnector } from "./tiktok.ts";
import { youtubeConnector } from "./youtube.ts";
import { isMockAccountId, mockConnector } from "./mock.ts";

const REGISTRY: Record<string, SocialConnector> = {
  instagram: instagramConnector,
  threads: threadsConnector,
  tiktok: tiktokConnector,
  youtube: youtubeConnector,
};

function notImplemented(platform: string): SocialConnector {
  return {
    platform,
    publish: (_req: PublishRequest): Promise<PublishOutcome> => Promise.resolve({
      status: "failed", kind: "unsupported", code: "not_implemented",
      message: `Площадка ${platform} не подключена в коде`,
    }),
    getPublication: () => Promise.resolve({ exists: null, reason: "площадка не подключена", retryable: false }),
    capabilities: () => ({
      publish_video: false, publish_image: false, publish_carousel: false, publish_story: false,
      get_publication: false, delete_publication: false, get_insights: false, get_account_metrics: false,
      get_comments: false, reply_comments: false, refresh_token: false,
    }),
  };
}

/** Mock разрешён только явной переменной окружения — на проде её нет. */
export function mockConnectorEnabled(env: { get(k: string): string | undefined } | undefined =
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env): boolean {
  return env?.get("PUBLISH_MOCK_CONNECTOR") === "1";
}

export function connectorFor(account: Pick<PublishAccount, "platform" | "external_account_id">): SocialConnector {
  if (isMockAccountId(account.external_account_id) && mockConnectorEnabled()) return mockConnector;
  return REGISTRY[account.platform] ?? notImplemented(account.platform);
}

export type { PublicationLookup, SocialConnector } from "./types.ts";
