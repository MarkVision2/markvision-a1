# Jobs: очередь публикаций, статусы, повторы, верификация, трасса

Фактическое поведение кода (`supabase/functions/_lib/publishRunner.ts`, `publishPolicy.ts`,
`publish-worker/index.ts`, миграции `20260901160000`, `20260907100000`, `20260909150000`, `20260909160000`, `20260909170000`).

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

## Кампании (Phase 2)

`publish_campaigns` = период × аккаунты (группа и/или список) × правило (`posts_per_day`, `slot_times`,
`weekdays`, `mode`, `distribution`) × очередь `publish_campaign_items`. Планировщик — SQL:

- `plan_campaign_day(campaign, day)` — для каждого времени слота дня берёт следующее видео очереди
  (`fanout`: одно видео во все годные аккаунты через `plan_publish_slots`; `spread`: каждому аккаунту
  своё видео по кругу) и помечает задания `campaign_id`. Идемпотентно: занятые слоты дня считаются
  по `planned_at` / заданиям аккаунта, прошедшие слоты (старше часа) не догоняются.
- `plan_publish_campaigns(days_ahead)` — все активные кампании на сегодня и завтра; крон
  `publish-campaign-planner-hourly` (`10 * * * *`). Запуск кампании из интерфейса/API планирует сразу.
- Автозавершение: очередь пуста (или период кончился) и нет открытых заданий → `completed`,
  уведомление и событие `campaign.completed`.
- Витрина `publish_campaign_metrics`: очередь, задания по статусам, ближайший слот, просмотры/охват/реакции.

Статусы: `draft → active ⇄ paused → completed → archived` (`campaign_status` в `publish-accounts`,
`POST /api/v1/campaigns/:id/start|pause|complete|archive`).

## Календарь и страницы (Phase 2)

- `publish-accounts action=calendar { from, to, account_ids?, group_id? }` — аккаунты и задания
  (`scheduled_at` в диапазоне, до 31 дня, до 2000 строк, `truncated`). Вкладка «Календарь» —
  неделя × аккаунт, день считается в поясе аккаунта (`src/lib/publishCalendar.ts`, как `published_day`
  в SQL); в ячейке «занято/лимит» по статусам `pending, retry, processing, verifying, published,
  manual_review`. Слоты кампаний появляются в календаре, когда планировщик создал задания (сегодня и завтра).
- `list { limit?, offset?, q?, platform?, group_id?, status?, publish_enabled? }` → `total`, `has_more`;
  без `limit` — весь список. `jobs_list { limit ≤ 500, offset, video_id?, account_id?, campaign_id? }`
  → `counts` по всей очереди, `has_more`. Интерфейс грузит аккаунты по 200 и задания по 200,
  «Показать ещё» растит страницу (`usePublishing`: `listAccountsUpTo` / `listJobsUpTo`).
- `accounts_bulk_update { account_ids ≤ 500, patch }` — один `UPDATE` на пачку (панель массовых
  действий, онбординг); `connect` / `connect_threads` принимают `preset` с теми же полями и применяют
  его ко всем только что подключённым аккаунтам.

## Вебхуки (Phase 2)

`publish_webhooks` (адрес https, события, зашифрованный секрет) + `publish_webhook_deliveries`.
События ставят триггеры: `publish_jobs` (`publication.published | failed | needs_human | unverified`),
`publish_notifications` (`account.reconnect_required`, `campaign.completed`, `report.daily` — kind
уведомления = событие). Доставка — edge `publish-webhooks` по крону ежеминутно (только когда есть
due-доставки): `POST` с заголовками `X-MarkVision-Event`, `X-MarkVision-Delivery`,
`X-MarkVision-Timestamp`, `X-MarkVision-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`.
2xx — `delivered`; 5xx / 429 / сеть — `retry` по лестнице 1 → 5 → 15 → 60 → 180 мин (5 попыток →
`failed`); прочие 4xx — `failed` сразу. Чистая часть — `_lib/webhooks.ts` (`src/test/webhooks.test.ts`).

## Рутины (Routine Engine)

`publish_routines.steps` — `[{ "action": "ACCOUNT_HEALTH_CHECK", "offset_minutes": -15 }, { "action": "METRICS_SYNC",
"offset_minutes": 20 }, …]`. Отрицательное смещение — от `scheduled_at` задания (проверки), положительное —
от `published_at` (метрики). Рутина берётся: аккаунт → группа → рутина проекта по умолчанию.

Триггер `publish_jobs_routine_tasks` материализует шаги в `publish_tasks`: «до»-шаги при создании
задания (и пересчитывает при переносе слота), «после»-шаги при переходе в `published`; при `failed` /
`cancelled` / уже состоявшейся публикации pending-проверки снимаются (`skipped`). Воркер
`publish-tasks` (крон ежеминутно, только при due-задачах) забирает задачи (`claim_publish_tasks`) и зовёт
существующие функции: health — `publish-monitor {mode: health, account_ids}`, метрики —
`publish-metrics {job_ids, checkpoint: "r<N>m"}` (точка `r20m`, `r240m`, … в `post_metrics`). До 3 попыток
с паузой 5 минут, потом `failed`. Задачи видны в трассе задания и `GET /api/v1/tasks`.

## Политика AI и согласование (Phase 4)

`publish-intake` получает `origin: "api"` от edge `api` (публичный API / MCP) и после планирования
слотов зовёт `applyAiPolicy`: помечает задания `origin = api`, читает `publish_project_settings.ai_policy`
/ `ai_daily_limit` и по `policyDecision` (`_lib/publishAiPolicy.ts`) переводит удержанные в
`manual_review` + `error_code = awaiting_approval` (`error_message` — причина). Суточный счёт assisted —
`origin = api` за сутки UTC без отменённых и удержанных. Уведомление `ai_pending_approval`
(dedupe по первому заданию пачки). Согласование — `jobs_approve` / `jobs_reject` в `publish-accounts`
(уровень RBAC `publish`): одобренное → `pending` со своим слотом (прошедший → сейчас), отклонённое →
`cancelled`; `jobs_list.counts.awaiting_approval` питает баннер во вкладке «Задания». Интерфейс,
кампании и конвейер `origin` не передают — для них ворот нет (у групп свой `review_mode`).

## AI Content Analyst

`publish-accounts action=analytics_insights { days }` → `buildContentInsights` (`_lib/publishInsights.ts`):
публикации из `publish_publications` за период, пояса аккаунтов, упавшие задания. Часы и дни недели —
в поясе аккаунта; корзина считается показательной от `MIN_SAMPLE = 3` измеренных публикаций; лидеры —
топ-5 аккаунтов по среднему score, аутсайдеры — три худших при выборке > 5. Рекомендации — русские
фразы из тех же чисел (лучшие часы против остальных, слабая площадка, доля подтверждённых постов,
главный класс отказов с подсказкой, лучший ролик как кандидат на варианты). Панель «Что работает»
во вкладке «Видео», `GET /analytics/insights`, MCP `markvision_content_insights`.

## Автопилот победителей (Phase 5)

`runWinnerReplication` (`publish-monitor mode=winner_replication`, крон `publish-monitor-winner-replication-daily`
06:50 UTC): проекты с `features.winner_replication_enabled` → `pickWinners` (is_winner, ≥ `MIN_MEASURED_FOR_REPLICATION`
= 3 измерений, до 3 победителей за проход) → `replicateContent`: тема ролика (`content_plan_items.publish_video_id`)
→ корень → `pickReplicationTargets` (группа не на паузе, ролик там не выходил, варианта и записи ещё нет,
до 10 групп) → `POST content-pipeline/items/:root/variants` по ключу автоматизации → строки
`publish_replications` (UNIQUE ролик × группа) → уведомление `winner_replicated`. Руками: `winner_replicate`
в `publish-accounts` (уровень `publish`), `POST /analytics/content/:id/replicate`, MCP; кнопка «По группам»
у лучших роликов в панели «Что работает». Метаданные `publish_videos.hook_type / cta_type / topic_key /
source_video_id` попадают в `publish_publications` и инсайты (`by_hook`, `by_cta`, `by_topic`).

## Роли (RBAC)

Роль в проекте (`_lib/rbac.ts`, SQL `project_role_of`): владелец → `owner`; явная `project_members.role`;
иначе по глобальной роли команды (admin/director → `admin`, manager → `manager`, marketer → `content_manager`,
viewer → `viewer`), участник без роли — `manager` (как до RBAC). Уровни вложены:

| Уровень | Роли | Действия |
|---|---|---|
| read | все | списки, метрики, трасса, уведомления, кампании, вебхуки (чтение) |
| operate | operator+ | повтор/отмена задания, проверка здоровья, отметить уведомление |
| publish | content_manager+ | «Залить видео», кампании (создать, очередь, start/pause) |
| manage | manager+ | аккаунты (подключить/отключить/правка), группы, персоны, настройки, ключи API, вебхуки, рутины |
| admin | admin, owner | роли участников (`member_role_set`; назначать `admin` может только владелец) |

Сервер (`publish-accounts`) отказывает 403 с текстом уровня; интерфейс прячет кнопки по `roleAllows`.
Ключи публичного API живут своими правами `read|publish|manage` и внутрь ходят как владелец.

## Ежедневный отчёт

`publish-monitor { mode: "daily_report" }` (крон `publish-monitor-daily-report`, 05:00 UTC): по каждому
проекту с аккаунтами — аккаунты (всего / здоровы / внимание), задания за 24 ч (запланировано /
опубликовано / ошибок / ждут, успешность), просмотры и охват за 7 дней, топ‑3 контента по score.
Уходит в Telegram (чат дайджеста или проекта, кроме `notify_mode = silent`), в центр уведомлений
(`report.daily`, один раз в день) и вебхукам. `GET /api/v1/reports/daily` — тот же JSON без отправки.

## Ретеншн

`publish_maintenance_gc(events_days=90, logs_days=90, api_logs_days=90, notif_days=180)` — крон
`publish-maintenance-daily` (03:50 UTC); доставки вебхуков и задачи рутин (завершённые) — 30 дней.
Значения — аргументы функции в `cron.job.command`.

## Нагрузочный тест (Mock)

1. В секретах edge-функций **тестового** проекта: `PUBLISH_MOCK_CONNECTOR=1`.
2. Завести аккаунты с `external_account_id` вида `mock:ok`, `mock:slow`, `mock:flaky`, `mock:token`,
   `mock:limit`, `mock:fatal`, `mock:unverified` (SQL или `publish-accounts connect_threads` с любым
   токеном — платформа не вызывается).
3. `POST /api/v1/publications` с `target.mode = "now"` на группу из 100 mock-аккаунтов × 3 видео.
4. Смотреть `publish_metrics`, `publish_job_events`, `publish_notifications`, `publish_content_metrics`.
Без переменной окружения mock-аккаунты идут в реальный публикатор своей площадки и падают на
проверке токена — на боевом проекте mock недостижим.
