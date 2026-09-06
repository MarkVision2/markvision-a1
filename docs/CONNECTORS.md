# Connectors: слой площадок

```
publishRunner ──► connectorFor(account) ──► SocialConnector
                                             ├─ publish()          → _lib/publishers/<platform>.ts
                                             ├─ getPublication()   → чтение поста (Verification Engine)
                                             └─ capabilities()     → _lib/publishCapabilities.ts
```

Код: `supabase/functions/_lib/connectors/` (`types.ts`, `index.ts`, `instagram.ts`, `threads.ts`,
`tiktok.ts`, `youtube.ts`, `mock.ts`, `http.ts`). Публикаторы (`_lib/publishers/`) остались как есть:
там контейнеры, resumable upload, классификация отказов. Коннектор — единая точка, через которую
ядро говорит с площадкой; UI и бизнес-логика API площадок не зовут.

## Контракт

```ts
interface SocialConnector {
  platform: string;
  publish(req: PublishRequest): Promise<PublishOutcome>;           // published | processing | failed{kind,code}
  getPublication({ account, token, externalPostId }): Promise<PublicationLookup>;
  capabilities({ account, token }): Capabilities;
}
type PublicationLookup =
  | { exists: true; url; platformStatus? }
  | { exists: false; reason }                 // площадка ответила: поста нет
  | { exists: null; reason; retryable };      // проверить не удалось (сеть/лимит/нет scope)
```

| Площадка | publish | getPublication | Особенности |
|---|---|---|---|
| Instagram | контейнер REELS → `media_publish` | `GET /{media}?fields=id,permalink` (граф по форме токена `IG…` / `EAA…`) | коды 100/803 = нет поста |

Instagram подключается тремя способами — вход логином Instagram (`IGAA…`, 60 дней),
вход через Facebook и страницы Meta-токена проекта (page-токен `EAA…`, бессрочный);
подробности — `docs/PUBLISHING-SYSTEM.md`, раздел «Онбординг Instagram».
| Threads | контейнер → `threads_publish` | `GET /{id}?fields=id,permalink` | текст ≤ 500 |
| TikTok | Direct Post `FILE_UPLOAD` кусками | `POST /v2/video/query/` (нужен scope `video.list`); `v_pub_…` = внутренний id → проверка недоступна | без публичного id — `skipped` |
| YouTube | resumable `videos.insert` | `GET /videos?part=status,snippet` (`uploadStatus` rejected/failed = нет) | privacy из `YOUTUBE_PRIVACY_STATUS` |
| Mock | детерминированные исходы по `external_account_id` | по режиму | только при `PUBLISH_MOCK_CONNECTOR=1` |

## Возможности (`publishCapabilities.ts`)

`resolveCapabilities({ platform, tokenKind, oauthScope, hasRefreshToken })` → словарь
`publish_video, publish_image, publish_carousel, publish_story, get_publication, delete_publication,
get_insights, get_account_metrics, get_comments, reply_comments, refresh_token`. Считается при
подключении (`publish-accounts connect/connect_threads`, `publish-oauth callback`) и при проверке
здоровья (`publish-monitor mode:health`), хранится в `publish_accounts.capabilities`. Раннер
проверяет `publish_video` перед публикацией (`CAPABILITY_MISSING` → `manual_review`). Пустой
объект (аккаунт до миграции) = ограничений нет.

`publish_image / publish_carousel / publish_story` пока `false` у всех: очередь принимает только
видео (`validateVideoRef`). Это возможность воркера, не площадки — включается вместе с поддержкой
типов медиа в `publish_videos`.

## Добавить площадку

1. `_lib/publishers/<platform>.ts` — `publishX(req): PublishOutcome` с классификацией отказов.
2. `_lib/connectors/<platform>.ts` — `publish` (делегирует), `getPublication`, `capabilities`.
3. Строка в `REGISTRY` (`connectors/index.ts`), ветка в `resolveCapabilities`, значение в CHECK
   `publish_accounts.platform` / `publish_jobs.platform` (миграция), OAuth в `publish-oauth`.
4. Метрики — ветка в `publish-metrics` / `normalizeInsights`.
Ядро (раннер, очередь, политика, трасса) не меняется.
