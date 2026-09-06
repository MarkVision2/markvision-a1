/**
 * Слой коннекторов — единый контракт площадки для Execution Router и раннера.
 *
 * Публикация делегируется существующим публикаторам (_lib/publishers/*):
 * там уже живут контейнеры, resumable upload, классификация отказов. Коннектор
 * добавляет то, чего у публикатора нет и что нужно ядру:
 *   - getPublication — прочитать пост обратно (Verification Engine);
 *   - capabilities — что умеет аккаунт этим токеном (Capability System);
 * и даёт одну точку расширения: новая площадка = один модуль здесь + строка в
 * реестре, ядро не меняется. Mock-коннектор для тестов и нагрузочной симуляции —
 * mock.ts (включается только переменной окружения, см. index.ts).
 */
import type { PublishAccount } from "../publishCore.ts";
import type { Capabilities } from "../publishCapabilities.ts";
import type { PublishOutcome, PublishRequest } from "../publishers/types.ts";

export type PublicationLookup =
  /** Пост найден у площадки этим токеном. */
  | { exists: true; url: string | null; platformStatus?: string | null; raw?: unknown }
  /** Площадка ответила, поста нет (удалён / ещё не виден / чужой id). */
  | { exists: false; reason: string; raw?: unknown }
  /** Проверить не удалось: сеть, лимит, нет scope — решение откладывается. */
  | { exists: null; reason: string; retryable: boolean; raw?: unknown };

export interface SocialConnector {
  platform: string;
  /** Опубликовать (делегирует публикатору площадки). */
  publish(req: PublishRequest): Promise<PublishOutcome>;
  /** Прочитать публикацию по platform media id. */
  getPublication(input: { account: PublishAccount; token: string; externalPostId: string }): Promise<PublicationLookup>;
  /** Возможности аккаунта этим токеном (детерминированно, без сети). */
  capabilities(input: { account: PublishAccount; token: string | null }): Capabilities;
}
