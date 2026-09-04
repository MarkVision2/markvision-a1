/**
 * Реестр публикаторов по площадкам.
 *
 * Работают Instagram и Threads. TikTok и YouTube объявлены заглушками с
 * готовым контрактом: задание уходит в manual_review, а не жжёт попытки, и в
 * журнал попадает ровно то, чего не хватает для запуска площадки. Порядок
 * подключения каждой — в docs/PUBLISHING-SYSTEM.md, раздел «Площадки».
 */
import type { Platform } from "../publishing.ts";
import type { PublishOutcome, Publisher, PublishRequest } from "./types.ts";
import { publishInstagram } from "./instagram.ts";
import { publishThreads } from "./threads.ts";

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

  // TikTok Content Posting API: POST /v2/post/publish/video/init/ с
  // PULL_FROM_URL (домен видео должен быть верифицирован в приложении),
  // затем опрос /v2/post/publish/status/fetch/ до PUBLISH_COMPLETE.
  tiktok: notImplemented("tiktok", "нужны client_key/secret приложения TikTok и верифицированный домен видео"),

  // YouTube Data API v3 videos.insert — загрузка тела файла (publish_videos.local_path),
  // не по URL. Непроверенные проекты публикуют только в private: нужен audit.
  youtube: notImplemented("youtube", "нужен OAuth-клиент Google Cloud и audit проекта для public-загрузок"),

  // Threads API: тот же двухшаговый порядок, что у Instagram, отдельный токен
  // площадки (publish-accounts action connect_threads).
  threads: publishThreads,
};

export function publisherFor(platform: Platform): Publisher {
  return REGISTRY[platform];
}

export type { PublishOutcome, PublishRequest } from "./types.ts";
