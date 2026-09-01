/**
 * Контракт публикатора: одна площадка = одна функция вида
 * (запрос) → исход. Так воркер очереди и HTTP-endpoint publish-dispatch
 * работают с любой платформой одинаково, а различия API живут в модуле
 * площадки.
 */
import type { Platform, PublishAccount } from "../publishing.ts";

export type FailureKind =
  /** Токен мёртв — аккаунт уходит в token_expired, нужен reconnect. */
  | "token"
  /** Упёрлись в лимит площадки — аккаунт уходит в limited до разбора. */
  | "limit"
  /** Сеть, 5xx, «сервис занят» — имеет смысл повторить позже. */
  | "temporary"
  /** Площадка отказала по существу (формат, длительность, политика). */
  | "fatal"
  /** Площадка ещё не подключена в коде — задание уходит на ручной разбор. */
  | "unsupported";

export type PublishOutcome =
  | { status: "published"; externalPostId: string; externalPostUrl: string | null; raw?: unknown }
  /** Медиа принято, но ещё обрабатывается — добьём на следующем тике очереди. */
  | { status: "processing"; containerId: string; raw?: unknown }
  | { status: "failed"; kind: FailureKind; code: string; message: string; raw?: unknown };

export interface PublishRequest {
  account: PublishAccount;
  /** Расшифрованный токен площадки. */
  token: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  /** Готовая подпись (текст + хэштеги уже склеены). */
  caption: string;
  title?: string | null;
  /** Незавершённая загрузка из прошлой попытки — не заливаем видео заново. */
  containerId?: string | null;
  /** Сколько всего ждём обработку медиа в одном вызове. */
  budgetMs?: number;
}

export type Publisher = (req: PublishRequest) => Promise<PublishOutcome>;

export interface PublisherModule {
  platform: Platform;
  publish: Publisher;
}
