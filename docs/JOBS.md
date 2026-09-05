# Jobs: очередь публикаций, статусы, повторы, верификация, трасса

Фактическое поведение кода (`supabase/functions/_lib/publishRunner.ts`, `publishPolicy.ts`,
`publish-worker/index.ts`, миграции `20260901160000`, `20260907100000`, `20260908100000`).

## Жизненный цикл задания (`publish_jobs.status`)

```
pending ──claim──► processing ──площадка приняла──► verifying ──пост прочитан──► published (verified)
   ▲                   │                               │
   │                   ├──► retry ──(next_attempt_at)──┘ (claim снова)      │ не прочитан за 5 проверок
   │                   ├──► manual_review                                    ▼
   └───────retry───────┴──► failed                             published (unverified) + уведомление
                                                     нет прав читать пост → published (skipped)
```

| Статус | Кто ставит | Смысл |
|---|---|---|
| `pending` | `plan_publish_slots` / `publish-intake` / `job_retry` | ждёт `scheduled_at` |
| `processing` | `claim_publish_jobs` | воркер держит аренду `locked_at` (10 мин), `attempts + 1` |
| `verifying` | раннер после `published`-исхода публикатора | площадка вернула `external_post_id`; ждём подтверждения чтением |
| `published` | `verifyPublishJob` | `verification_status` = `verified` / `unverified` / `skipped` |
| `retry` | раннер | временный сбой, мёртвый токен, лимит, «медиа обрабатывается» |
| `failed` | раннер | отказ по существу или исчерпаны попытки (DLQ) |
| `manual_review` | раннер | площадка/возможность не поддерживается, аккаунт не восстановлен за 5 попыток |
| `cancelled` | оператор / API | не ушло на площадку |

Учёт аккаунта (`published_today`, `last_post_at`, здоровье +1) срабатывает триггером при переходе
в `published`, то есть после верификации — не по ответу площадки.

## Политика ошибок (`_lib/publishPolicy.ts`)

Публикатор классифицирует отказ (`FailureKind`: `token | limit | temporary | fatal | unsupported`),
политика превращает его в канонический класс (`publish_jobs.error_class`) и решение:

| Kind | Класс | Решение |
|---|---|---|
| `token` | `AUTH_EXPIRED` / `AUTH_REVOKED` / `RECONNECT_REQUIRED` | `retry` через ~60 мин (±20 %), после 5 попыток — `manual_review`; аккаунт → `token_expired`, уведомление `account.reconnect_required` |
| `limit` | `RATE_LIMIT` | `retry` через ~60 мин, после 5 — `manual_review`; аккаунт → `limited` |
| `temporary` | `PLATFORM_TEMPORARY_ERROR` / `NETWORK_ERROR` / `TIMEOUT` | `retry` с backoff 1→2→4→8→16→30 мин ±20 % джиттер; после 5 — `failed` |
| `fatal` | `MEDIA_INVALID` / `MEDIA_TOO_LARGE` / `MEDIA_PROCESSING_FAILED` / `PLATFORM_PERMISSION_ERROR` / `ACCOUNT_RESTRICTED` / `UNKNOWN_ERROR` | `failed` сразу |
| `unsupported` | `NOT_IMPLEMENTED` / `CAPABILITY_MISSING` | `manual_review` сразу, попытки не жгутся |

Опрос обработки медиа (`processing`-исход) — не попытка: `poll_count` до 30, затем `failed
processing_timeout`. Идемпотентность: `UNIQUE (video_id, account_id)`, `container_id` до публикации,
`client_ref` у видео для внешних клиентов.

## Верификация (`verifyPublishJob`)

1. Сразу после ответа площадки — одна попытка `connector.getPublication()`.
2. Не найден / сеть — статус `verifying`, `next_attempt_at` по лестнице 1.5 → 3 → 6 → 12 → 20 мин.
3. Второй проход воркера (`claim_publish_verifications`, партиция 0) читает пост снова.
4. Пять неудач — `published` + `verification_status = unverified` + уведомление `publication.unverified`
   (повторная публикация дала бы дубль — пост, скорее всего, есть).
5. Нет права читать (TikTok без `video.list`, внутренний `v_pub_…` id) — `skipped`.

`post_metrics_due` не снимает метрики с `unverified`.

## Трасса (`publish_job_events`, `trace_id`)

Каждое задание несёт `trace_id`; шаги пишет `traceStep()` и дублирует структурной строкой JSON в
логи функции (`scope: "publish"`). Шаги: `JOB_CLAIMED → CAPABILITY_OK → AUTH_OK|AUTH_REFRESHED →
MEDIA_OK → UPLOAD_STARTED|PROVIDER_PROCESSING → MEDIA_CREATED → VERIFY_STARTED → VERIFIED|
VERIFY_PENDING|VERIFY_SKIPPED|UNVERIFIED → SUCCESS`, отказы — `RETRY | FAILED | MANUAL_REVIEW |
CAPABILITY_MISSING | AUTH_FAILED`. Данные шага чистятся от ключей `token|secret|authorization|
password|cookie`. Сырые ответы площадок — по-прежнему `publish_logs`.

Просмотр: вкладка «Задания» → кнопка трассы; `POST publish-accounts {action:"job_get"}`;
`GET /api/v1/jobs/:id`; MCP `markvision_get_job`.

## Воркер

`publish-worker` ×3 партиции ежеминутно (`batch 25`, бюджет 45 с на вызов, 20 с на задание).
Первый проход — `claim_publish_jobs` + `runPublishJob`, второй (партиция 0) —
`claim_publish_verifications` + `verifyPublishJob`. Ответ функции — счётчики
`claimed / published / verifying / processing / retry / failed / manual_review / verified / unverified / verify_pending`.

## Ретеншн

`publish_maintenance_gc(events_days=90, logs_days=90, api_logs_days=90, notif_days=180)` — крон
`publish-maintenance-daily` (03:50 UTC). Значения — аргументы функции в `cron.job.command`.

## Нагрузочный тест (Mock)

1. В секретах edge-функций **тестового** проекта: `PUBLISH_MOCK_CONNECTOR=1`.
2. Завести аккаунты с `external_account_id` вида `mock:ok`, `mock:slow`, `mock:flaky`, `mock:token`,
   `mock:limit`, `mock:fatal`, `mock:unverified` (SQL или `publish-accounts connect_threads` с любым
   токеном — платформа не вызывается).
3. `POST /api/v1/publications` с `target.mode = "now"` на группу из 100 mock-аккаунтов × 3 видео.
4. Смотреть `publish_metrics`, `publish_job_events`, `publish_notifications`, `publish_content_metrics`.
Без переменной окружения mock-аккаунты идут в реальный публикатор своей площадки и падают на
проверке токена — на боевом проекте mock недостижим.
