/**
 * MockSocialConnector — площадка без сети для тестов и нагрузочной симуляции.
 *
 * Достижим ТОЛЬКО когда переменная окружения PUBLISH_MOCK_CONNECTOR=1 и
 * external_account_id аккаунта начинается на "mock:" (см. index.ts). На боевом
 * проекте без переменной mock не выбирается никогда — реальные аккаунты идут в
 * реальные публикаторы.
 *
 * Поведение управляется external_account_id аккаунта, чтобы один прогон
 * покрывал разные ветки очереди:
 *   mock:ok            — публикует сразу, верификация проходит;
 *   mock:slow          — первый вызов processing (контейнер), второй — published;
 *   mock:flaky         — временный сбой на нечётных попытках;
 *   mock:token         — мёртвый токен;
 *   mock:limit         — лимит площадки;
 *   mock:fatal         — отказ по существу;
 *   mock:unverified    — публикует, но прочитать пост обратно не даёт.
 */
import type { SocialConnector } from "./types.ts";
import type { PublishOutcome, PublishRequest } from "../publishers/types.ts";
import { resolveCapabilities } from "../publishCapabilities.ts";

let counter = 0;

export const MOCK_PREFIX = "mock:";

export function isMockAccountId(externalAccountId: string | null | undefined): boolean {
  return typeof externalAccountId === "string" && externalAccountId.startsWith(MOCK_PREFIX);
}

export function mockPublish(req: PublishRequest): Promise<PublishOutcome> {
  const mode = req.account.external_account_id.slice(MOCK_PREFIX.length) || "ok";
  const attempt = ++counter;
  const id = `mock_${req.account.id.slice(0, 8)}_${Date.now().toString(36)}`;
  switch (mode) {
    case "slow":
      if (!req.containerId) return Promise.resolve({ status: "processing", containerId: `mock_container_${attempt}` });
      return Promise.resolve({ status: "published", externalPostId: id, externalPostUrl: `https://mock.local/p/${id}` });
    case "flaky":
      if (attempt % 2 === 1) return Promise.resolve({ status: "failed", kind: "temporary", code: "mock_temporary", message: "mock: временный сбой" });
      return Promise.resolve({ status: "published", externalPostId: id, externalPostUrl: `https://mock.local/p/${id}` });
    case "token":
      return Promise.resolve({ status: "failed", kind: "token", code: "190", message: "mock: токен недействителен" });
    case "limit":
      return Promise.resolve({ status: "failed", kind: "limit", code: "4", message: "mock: лимит площадки" });
    case "fatal":
      return Promise.resolve({ status: "failed", kind: "fatal", code: "mock_format", message: "mock: неподдерживаемый формат" });
    default:
      return Promise.resolve({ status: "published", externalPostId: id, externalPostUrl: `https://mock.local/p/${id}` });
  }
}

export const mockConnector: SocialConnector = {
  platform: "mock",
  publish: mockPublish,
  capabilities: () => resolveCapabilities({ platform: "instagram", tokenKind: "fb_page" }),
  getPublication({ account, externalPostId }) {
    const mode = account.external_account_id.slice(MOCK_PREFIX.length);
    if (mode === "unverified") return Promise.resolve({ exists: false, reason: "mock: пост не виден" });
    return Promise.resolve({ exists: true, url: `https://mock.local/p/${externalPostId}` });
  },
};
