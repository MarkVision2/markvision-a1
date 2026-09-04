/**
 * Реестр публикаторов по площадкам.
 *
 * Работают все четыре площадки: Instagram и Threads (контейнер → publish),
 * TikTok (Direct Post по ссылке), YouTube (resumable upload). notImplemented
 * оставлен для будущих площадок: задание уходит в manual_review, не жжёт
 * попытки. Подключение аккаунтов — publish-accounts (Instagram) и publish-oauth
 * (Threads / TikTok / YouTube).
 */
import type { Platform } from "../publishing.ts";
import type { PublishOutcome, Publisher, PublishRequest } from "./types.ts";
import { publishInstagram } from "./instagram.ts";
import { publishThreads } from "./threads.ts";
import { publishTikTok } from "./tiktok.ts";
import { publishYouTube } from "./youtube.ts";

function notImplemented(platform: Platform, missing: string): Publisher {
  return (_req: PublishRequest): Promise<PublishOutcome> =>
    Promise.resolve({
      status: "failed",
      kind: "unsupported",
      code: "not_implemented",
      message: `Публикатор ${platform} ещё не подключён: ${missing}`,
    });
}

const REGISTRY: Record<Platform, Publisher> = {
  instagram: publishInstagram,

  // TikTok Content Posting API (PULL_FROM_URL, домен видео верифицирован в приложении).
  tiktok: publishTikTok,

  // YouTube Data API v3 videos.insert — resumable upload тела файла.
  youtube: publishYouTube,

  // Threads API: тот же двухшаговый порядок, что у Instagram, отдельный токен
  // площадки (publish-accounts action connect_threads).
  threads: publishThreads,
};

export function publisherFor(platform: Platform): Publisher {
  return REGISTRY[platform] ?? notImplemented(platform, "площадка не зарегистрирована");
}

export type { PublishOutcome, PublishRequest } from "./types.ts";
