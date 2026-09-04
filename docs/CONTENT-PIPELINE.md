# Контент-конвейер: производство и согласование Reels

Тема из контент-плана MarkVision → сценарий (OpenAI) → вертикальное видео (HeyGen) →
единый формат (FFmpeg-worker) → согласование (MarkVision / Telegram). Реализация ТЗ
«MarkVision AI: система производства и согласования контента» v1.0 (этапы 1–4 в коде,
этап 0 — скриптом smoke test). Публикация в площадки — **отдельный модуль**
(`docs/PUBLISHING-SYSTEM.md`), сюда не входит.

```
MarkVision UI (карточка темы → вкладка «AI-видео»)
    │  JWT
    ▼
Edge-функция content-pipeline ──── Supabase: content_plan_items + pipeline_runs
    ▲  HMAC-подпись                           + content_assets + content_reviews
    │                                         + claim_next_content_job() (SKIP LOCKED)
n8n «AI Content Pipeline v5» ──── OpenAI ── HeyGen ── FFmpeg-worker (172.18.0.1:9120)
                                                              │
                                              Caddy /media/content-pipeline (read-only)
Telegram-бот согласования ◄──── кнопки «Одобрить / Отклонить» + причина отклонения
```

## Что где

| Часть | Файл |
|---|---|
| Схема: таблицы, RLS, RPC очереди, зависшие, метрики, крон | `supabase/migrations/20260904120000_content_pipeline.sql` |
| Чистая логика (состояния, backoff, валидация сценария, подпись, маскирование, SSRF) | `supabase/functions/_lib/contentPipeline.ts` |
| Backend API + callback n8n + Telegram + обслуживание | `supabase/functions/content-pipeline/index.ts` |
| Интерфейс: клиент, хук, панель, вкладка в карточке | `src/lib/contentPipeline.ts`, `src/hooks/useContentPipeline.ts`, `src/components/content-plan/ContentPipelinePanel.tsx`, `src/pages/ContentPlanDetail.tsx` |
| FFmpeg-worker (исходник, unit, env) | `worker/content-worker/` |
| n8n (экспорт без секретов) | `docs/n8n-content-pipeline-v5.json`, `docs/n8n-content-pipeline-callback.json` |
| Диагностика и smoke test | `scripts/content-pipeline-smoke.mjs` |
| Тесты | `src/test/contentPipeline.test.ts`, `src/test/contentPipelinePanel.test.tsx`, `src/test/contentWorkerUrlGuard.test.ts` |

## Модель состояний

Пользовательский статус темы (`content_plan_items.status`): `idea` → `in_progress` →
`ready` → `published`; отдельно `failed` (попытки исчерпаны) и `cancelled`. Технический
этап живёт в `pipeline_runs.state`, не в `ai_analysis`:

```
queued → claimed → script_generating → script_ready → video_requested → video_rendering
       → video_ready → normalizing → awaiting_review → approved | rejected
любой активный этап → retry_wait (возврат в очередь, тот же запуск) | failed | cancelled
```

Разрешённые переходы — `ALLOWED_TRANSITIONS` в `_lib/contentPipeline.ts`; edge-функция
отвергает всё остальное (409). Каждый переход пишется в `pipeline_run_events` — из него
считаются длительности этапов (`content_pipeline_stage_durations`).

Соответствие этап → статус темы: `awaiting_review`/`approved` → `ready`, `rejected` →
`idea` (новая попытка), `failed` → `failed`, остальное → `in_progress`.

## Таблицы

| Таблица | Назначение | Кто пишет |
|---|---|---|
| `content_plan_items` | тема (как и раньше) + `pipeline_run_id`, статусы `failed`/`cancelled` | пользователь (RLS), сервер |
| `content_pipeline_settings` | параметры проекта: язык, 90–130 слов, tone of voice, запреты, аватар/голос HeyGen, 720×1280, таймаут видео, max попыток, параллельность, дневной/месячный бюджет, чат Telegram | пользователь проекта (RLS) |
| `pipeline_runs` | одна строка = одна попытка: этап, provider_job_id, attempt, heartbeat, next_retry_at, ошибки (код / текст оператору / текст пользователю / нода / время), cost_usd, metadata (сценарий, usage, prompt_version) | только service_role |
| `pipeline_run_events` | журнал переходов | триггер |
| `content_assets` | файлы с версиями (`provider_video`, `normalized_video`), ffprobe-характеристики, sha256; unique (тема, тип, версия) — перезапись невозможна | service_role |
| `content_reviews` | решения: кто, откуда (`markvision`/`telegram`), когда, комментарий; unique на попытку — повторное решение упирается в 409 | service_role |
| `pipeline_review_tokens` | одноразовые токены кнопок Telegram (7 дней), `prompt_message_id` для причины отклонения | service_role, без политик |
| `pipeline_callback_nonces`, `pipeline_telegram_updates` | replay-защита callback и дедуп апдейтов Telegram | service_role, без политик |

Чтение `pipeline_runs`, `content_assets`, `content_reviews`, `pipeline_run_events` —
через RLS `user_can_access_project`: пользователь проекта А не видит asset проекта Б
(сценарий 18 ТЗ).

### RPC

* `claim_next_content_job(p_worker_id, p_project_id default null)` — `FOR UPDATE SKIP
  LOCKED`; сначала возобновляет `retry_wait` с наступившим `next_retry_at` (тот же
  запуск, `provider_job_id` сохраняется), иначе берёт самую старую тему `REELS`+`idea`
  без активного запуска. Учитывает `enabled`, бюджет (`content_pipeline_budget_ok`)
  и `max_parallel_videos` (`content_pipeline_slot_free`). Пустая очередь → 0 строк.
  Перед забором вызывает `requeue_stale_content_jobs()`.
* `requeue_stale_content_jobs()` — heartbeat старше 15 мин на безопасных этапах →
  `retry_wait` сразу; на `video_requested`/`video_rendering` порог `video_timeout_minutes + 10`
  (заказ у провайдера уже есть — воркер сначала проверит его); `attempt >= max_attempts`
  → `failed` + тема `failed`. `awaiting_review` не зависает никогда.
* `content_pipeline_spend`, `content_pipeline_budget_ok`, `content_pipeline_settings_json`,
  `content_pipeline_gc`.

Витрина `content_pipeline_metrics`: размер очереди, возраст старейшей темы, активные /
ожидающие / retry / упавшие за сутки, повторы, расход сегодня и за месяц, объём файлов.

## Endpoint'ы (`/functions/v1/content-pipeline/…`)

Пользовательские — JWT MarkVision, доступ к теме проверяется RLS пользователя:

| Маршрут | Что делает |
|---|---|
| `POST /items` `{project_id, title, description?, prompts?, category?}` | создать тему REELS в `idea` |
| `GET /items/:id` | статус темы, текущий запуск (этап, попытка, heartbeat, безопасная ошибка, события), сценарий, история запусков, assets, решения, флаги `can.*` |
| `POST /items/:id/generate` | идемпотентно: активный запуск есть → вернуть его; иначе тема → `idea` + пинок n8n (`N8N_CONTENT_PIPELINE_WEBHOOK_URL`). Проверяет `enabled` и бюджет |
| `POST /items/:id/review` `{decision, comment?}` | только на `awaiting_review`; для `rejected` комментарий обязателен; второй раз → 409 |
| `POST /items/:id/retry` | только для `failed` / `rejected` / `cancelled` |
| `POST /items/:id/cancel` | отменить активный запуск |
| `POST /items/:id/settings` `{target_group_id?, persona_id?, engine?}` | цель публикации, персона и движок — только без активного запуска (иначе 409); группа подтягивает персону, персона — движок |

Закрытый callback для n8n — `POST /internal/callback`, заголовки `x-pipeline-timestamp`
(мс или с), `x-pipeline-nonce` (8–128 символов, один раз), `x-pipeline-signature` =
HMAC-SHA256(`timestamp.nonce.body`, `CONTENT_PIPELINE_CALLBACK_SECRET`) hex; окно 5 минут.
Тело `{event, …}`:

| event | Поля | Результат |
|---|---|---|
| `claim` | `worker_id`, `project_id?` | `job` или `null`. В `job`: `run_id`, `item_id`, `attempt`, `resumed`, `provider_job_id`, сохранённые `script`/`video_url`, настройки проекта, готовые `script_prompt` (+ комментарий последнего отклонения) и `script_schema` |
| `heartbeat` | `run_id` | обновить heartbeat |
| `state` | `run_id`, `state`, `metadata?` | переход с проверкой машины состояний |
| `script` | `run_id`, `script_raw`, `model`, `usage`, `prompt_version` | валидация (поля, 90–130 слов, ≥3 хештега, запреты) → `script_ready`, стоимость OpenAI; невалидно → `{valid:false, errors}` (n8n повторяет не более раза) |
| `video_requested` | `run_id`, `provider_job_id` | сохраняет job ID; если уже есть → `already:true` (второй платный заказ невозможен) |
| `video_status` | `run_id`, `status`, `video_url?`, `duration_seconds?`, `error?` | `completed` → `video_ready` + стоимость HeyGen (`HEYGEN_USD_PER_MINUTE`); `failed` → fail; иначе `video_rendering` + `poll_again`, таймаут `video_timeout_minutes` → `retry_wait`/`failed` |
| `asset` | `run_id`, `asset_type`, `public_url`, `size_bytes`, `width`, `height`, `duration_seconds`, кодеки, `checksum_sha256` | новая версия в `content_assets`; для `normalized_video` — `media_url` темы, `awaiting_review`, сообщение в Telegram с кнопками |
| `fail` | `run_id`, `error_code`, `error_message`, `node`, `kind`, `retry_after?` | backoff по `kind`: сеть/5xx 5→30→120 с, 429 по `Retry-After`, validation/auth — без повтора, provider_timeout → `retry_wait` без нового заказа; лимит попыток → `failed` + уведомление оператору |

Telegram — `POST /telegram` (`x-telegram-bot-api-secret-token` = `CONTENT_PIPELINE_TELEGRAM_SECRET`):
`callback_query` кнопок (`cp:<token>`), «Отклонить» → бот просит причину ответом на
сообщение (ForceReply) → ответ завершает отклонение. Повторное нажатие — «решение уже
принято». Обслуживание — `POST /maintenance` (`x-automation-key`), pg_cron каждые 10 минут.

## Повторы, идемпотентность, зависшие

* `pipeline_run_id` есть у каждой попытки; `provider_job_id` пишется до ожидания.
  Потеря HTTP-ответа после создания HeyGen job: при возобновлении claim отдаёт
  `provider_job_id`, n8n пропускает создание и идёт опрашивать статус.
* Один активный запуск на тему — уникальный индекс поверх RPC.
* Callback: nonce одноразовый (PK), окно 5 минут — replay отвергается (409).
* Telegram: `update_id` одноразовый, токен кнопки одноразовый, решение на попытку одно.
* Зависшие: см. `requeue_stale_content_jobs()`; крон дополнительно шлёт оператору
  окончательные ошибки (`metadata.operator_notified`) и раз в час — «очередь стоит > 3 ч».
* Пустая очередь — не уведомление. Уведомления только: окончательная ошибка, зависшая
  очередь, ролик на согласовании (само сообщение с кнопками).

Секреты в ошибках маскируются (`maskSecrets`): Bearer, `sk-…`, JWT, токены ботов,
`api_key`/`token`/`secret`, `sb_secret_…`.

## n8n

Импортировать **сначала** `docs/n8n-content-pipeline-callback.json` (под-воркфлоу
«Content Pipeline · callback»: подготовка подписи → нода Crypto HMAC → POST), скопировать
его ID, затем импортировать `docs/n8n-content-pipeline-v5.json` и во всех нодах
«callback: …» выбрать этот под-воркфлоу (в экспорте — `PASTE_CALLBACK_WORKFLOW_ID`).
Секреты — только в нодах «Настройки» (`PASTE_…`): ключ вебхука, OpenAI, HeyGen, токен
воркера; в под-воркфлоу — `CONTENT_PIPELINE_CALLBACK_SECRET`.

```
Каждый час ─┐
Webhook ────┴→ Настройки → Проверка входа → callback: claim → Есть задание? ─нет→ Очередь пуста
   ├─ Сценарий уже есть? ─нет→ state script_generating → OpenAI → callback: script → валиден? ─нет→ (1 повтор) → fail
   ├─ Видео уже заказано? ─нет→ HeyGen /v2/video/generate → callback: video_requested
   ├─ Ждать 30 с → HeyGen status → callback: video_status → готово? ─нет→ опрашивать? → Ждать 30 с
   └─ state normalizing → Worker /normalize → callback: asset → Готово: на согласовании
```

Один запуск = одна тема; расписание раз в час (ТЗ 7.2), ручной запуск — edge-функция
шлёт `POST /webhook/generate-content` с `x-pipeline-key`. Воркфлоу «Telegram Error Alert»
остаётся Error Workflow (Settings → Error workflow). Старый v4 после проверки v5
выключить, не удалять (rollback).

## FFmpeg-worker

`worker/content-worker/server.mjs` (Node 22, без зависимостей). `POST /normalize
{source_url, content_id, version?}` с `x-worker-token`:

1. allowlist доменов HeyGen + запрет private/loopback/link-local/CGNAT, IP-литералов,
   учётных данных и портов; DNS-ответ тоже проверяется на приватные адреса;
   редиректы не следуются;
2. потоковая загрузка с лимитом байт (300 МБ) и таймаутом, проверка Content-Type;
3. `ffprobe` входа (есть видеопоток, длительность ≤ 600 с);
4. `ffmpeg`: scale/pad до 720×1280, libx264 (high 4.1, crf 20, 30 fps), yuv420p, AAC
   128k 48 kHz (немому файлу добавляется тишина), `+faststart`;
5. `ffprobe` результата — формат сверяется, sha256;
6. запись во временный файл и атомарный `rename`; существующий файл никогда не
   перезаписывается (`409 exists` — нужен новый `version`).

`GET /health` — ffmpeg/ffprobe, активные задания, диск с порогами 70/85 %.
`POST /gc {keep_days}` — удаление файлов старше N дней и осиротевших `.tmp`.
`node server.mjs --self-test` — синтетический клип через тот же путь (проверено на
ffmpeg 6.0 и старой статической сборке 2018 года).

Установка — комментарий в `markvision-content-worker.service` (отдельный пользователь
`cworker`, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome`,
`CPUQuota`, `MemoryMax`, `ReadWritePaths` только каталог медиа). Env —
`worker/content-worker/.env.example`. Существующий на сервере worker заменить этим
исходником: контракт ответа совместим (`url`, `size_bytes`, `duration_seconds`, кодеки,
`checksum_sha256`).

## Переменные окружения

Supabase → Edge Functions → Secrets (функция `content-pipeline`):

| Переменная | Назначение |
|---|---|
| `CONTENT_PIPELINE_CALLBACK_SECRET` | HMAC-секрет callback n8n (тот же в под-воркфлоу) |
| `CONTENT_PIPELINE_TELEGRAM_SECRET` | secret_token вебхука бота согласования (`setWebhook`) |
| `CONTENT_PIPELINE_BOT_TOKEN` | токен бота согласования; если пусто — `TELEGRAM_BOT_TOKEN` |
| `CONTENT_PIPELINE_ALERT_CHAT_ID` | чат оператора для аварий; если пусто — чат проекта |
| `N8N_CONTENT_PIPELINE_WEBHOOK_URL` | `https://n8n.zapoinov.com/webhook/generate-content` — пинок из «Сгенерировать» |
| `N8N_CONTENT_PIPELINE_WEBHOOK_KEY` | значение `x-pipeline-key` (то же в ноде «Настройки» n8n) |
| `HEYGEN_USD_PER_MINUTE` | ставка для оценки расхода HeyGen (по умолчанию 1) |
| `APP_PUBLIC_URL` | базовый URL приложения для ссылки на карточку в Telegram |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | стандартные |

n8n («Настройки»): `webhook_key`, `openai_api_key`, `heygen_api_key`, `worker_url`,
`worker_token`, `worker_id`, `poll_seconds`; под-воркфлоу: `callback_url`,
`callback_secret`. Воркер: `worker/content-worker/.env.example`. Service-role ключ
Supabase в n8n **не нужен** и не должен там оставаться.

Telegram-бот: `setWebhook` на `…/functions/v1/content-pipeline/telegram` с
`secret_token` и `allowed_updates: ["message","callback_query"]`. Чат согласования —
`content_pipeline_settings.telegram_chat_id`, иначе чат проекта из `telegram_links`.

## Деплой и rollback

1. Влить ветку в `main` — миграция и функция выкатываются `supabase-deploy.yml`
   (миграция идемпотентна: `IF NOT EXISTS` / `DROP … IF EXISTS`).
2. Добавить секреты edge-функции (таблица выше).
3. Развернуть воркер по комментарию в unit-файле, `node server.mjs --self-test`.
4. Импортировать n8n: callback → v5, подставить ID под-воркфлоу и секреты, включить v5,
   выключить v4.
5. `node scripts/content-pipeline-smoke.mjs doctor --key <cron_secret>`.
6. Этап 0: `node scripts/content-pipeline-smoke.mjs e2e --jwt … --project … --decision approved`,
   затем повторить с `--decision rejected --comment "…"`.

Rollback: выключить v5 и включить v4 в n8n (v4 пишет в `ai_analysis`, новые таблицы ему
не мешают); интерфейс при отсутствии запусков показывает «Сгенерировать» и ничего не
ломает. Откат схемы не требуется; при необходимости — `DROP TABLE` новых таблиц в
обратном порядке зависимостей (`content_reviews`, `content_assets`,
`pipeline_review_tokens`, `pipeline_run_events`, `pipeline_runs`, …) и возврат
`content_plan_items_status_check` к прежнему списку.

## Runbook

| Симптом | Где смотреть | Что делать |
|---|---|---|
| Тема висит в `idea` | `content_pipeline_metrics.queue_size`, n8n executions v5, `enabled`, `content_pipeline_budget_ok(project)` | пинок `POST /items/:id/generate`; проверить ключ вебхука; бюджет |
| `in_progress` без движения | `pipeline_runs.heartbeat_at`, `state` | ждать крон (10 мин) или `POST /maintenance`; в n8n — execution по `run_id` |
| `retry_wait` крутится | `error_code`, `error_message`, `attempt` | причина в `error_message` (уже без секретов); после `max_attempts` станет `failed` |
| `failed` | `error_user` (пользователю), `error_message`+`error_node` (оператору), `pipeline_run_events` | исправить причину, «Повторить» в карточке |
| Второе видео за одну тему | `pipeline_runs.provider_job_id`, `pipeline_runs_one_active_per_item_uidx` | не должно случаться: claim отдаёт `provider_job_id`, `video_requested` идемпотентен |
| Telegram без кнопок / кнопки «уже принято» | `pipeline_review_tokens`, `content_reviews` | токен использован или истёк (7 дней); решение — из MarkVision |
| Callback 401/409 | `x-pipeline-*` заголовки, часы n8n (окно 5 мин), nonce уникален | сверить секрет; 409 = replay |
| Воркер 4xx | `journalctl -u markvision-content-worker`, код `url_*`/`exists`/`too_large` | источник вне allowlist или файл уже есть — новый `version` |
| Диск | `GET /health` воркера (`disk.level`), `content_pipeline_metrics.assets_bytes` | `POST /gc {keep_days}`; retention отклонённых/старых |
| Сервер перезагрузился | `systemctl status markvision-content-worker n8n docker` | сервисы `enabled`; незавершённые запуски вернёт крон (`retry_wait`), видео-этапы — по `provider_job_id` |

Ключ отозван (сценарий 17): OpenAI/HeyGen → `kind: auth` → без повтора → `failed`,
уведомление оператору с `error_code`; после ротации ключа в n8n — «Повторить».

## Резервное копирование

Метаданные — обычный бэкап Postgres Supabase (таблицы выше; `pipeline_runs.metadata`
хранит сценарий и usage, поэтому история восстанавливается без файлов). Файлы —
`/var/www/media/content-pipeline` (отдельно, большие): `rsync`/snapshot по расписанию;
для восстановления достаточно вернуть каталог — ссылки в `content_assets.public_url`
детерминированы (`<content_id>_v<version>.mp4`). Конфигурация n8n — экспорт воркфлоу в
`docs/` (без секретов) + `/root/n8n/backups/`.

## Тестовые сценарии ТЗ (§17) — как проверить

| # | Сценарий | Проверка |
|---|---|---|
| 1 | Пустая очередь | запуск v5 вручную → «Очередь пуста», без уведомлений; в SQL — RPC вернул 0 строк (проверено локально) |
| 2 | Одна тема | `smoke e2e` |
| 3 | Два одновременных запуска | два ручных запуска v5 → второй берёт другую тему или пусто (RPC `SKIP LOCKED`, unique-индекс; проверено локально) |
| 4 | Невалидный ответ OpenAI | callback `script` → `valid:false` → один повтор → `fail script_invalid` (unit-тесты валидации) |
| 5 | 429 OpenAI | `fail kind=rate_limited retry_after` → `retry_wait` на `Retry-After` |
| 6 | HeyGen долго | `video_status` после `video_timeout_minutes` → `retry_wait` без нового заказа, потом `failed` |
| 7 | HeyGen ошибка | `video_status status=failed` → `failed` + уведомление |
| 8 | Потеря связи после создания job | остановить n8n после `callback: video_requested`; крон вернёт в `retry_wait`, resume идёт в опрос по `provider_job_id` |
| 9 | Запрещённый URL воркера | `curl -X POST /normalize` с `https://127.0.0.1/…` → `400 url_ip_literal` (проверено) |
| 10 | Большой / битый файл | `413 too_large`, `422 probe_failed` |
| 11 | FFmpeg упал | `500 ffmpeg_failed` → n8n `fail normalize_failed` → backoff |
| 12 | Telegram callback дважды | второй → «Решение уже принято»; `smoke e2e --decision` проверяет 409 из MarkVision |
| 13 | Отклонение с комментарием | Telegram ForceReply или карточка; комментарий уходит в промпт следующей попытки |
| 14 | Рестарт n8n во время ожидания | `saveExecutionProgress` + крон: stale → `retry_wait` → resume |
| 15 | Рестарт сервера во время FFmpeg | `.tmp` не публикуется; запуск → `retry_wait`; `gc` чистит `.tmp` |
| 16 | Диск заполнен | `/health disk.level`, ffmpeg ошибка → `normalize_failed`; `POST /gc` |
| 17 | Ключ отозван | `kind=auth` → `failed` сразу + уведомление |
| 18 | Чужой asset | RLS: `GET /items/:id` чужой темы → 404; `content_assets` select только по проекту |

## Наблюдаемость

`select * from content_pipeline_metrics` — очередь, возраст, активные, ожидающие,
успешные/упавшие за сутки, повторы, расход, объём файлов; `content_pipeline_stage_durations`
— длительность каждого этапа; воркер `/health` — диск и бинарники; доступность n8n —
`/healthz`. `scripts/content-pipeline-smoke.mjs doctor` собирает это в одну команду.

## Связка с платформой автопостинга

`POST /items/:id/variants { group_ids }` — варианты темы под группы аккаунтов с персоной
группы; `claim` подмешивает персону в промпт и фильтруется по движку (`engine`); после
`approved` ролик сам уходит в `publish_videos` и раскладывается по группе
(`plan_publish_slots`); группы `auto_publish` минуют ворота. Подробно —
`docs/AUTOPOSTING-PLATFORM.md`.

## Что не сделано в этом заходе

* Объектное хранилище (Supabase Storage/S3, signed URL) — медиа по-прежнему на диске
  сервера через Caddy; контракт `content_assets.storage_path/public_url` к переезду готов.
* Форма настроек проекта в интерфейсе — таблица `content_pipeline_settings` доступна по
  RLS, значения задаются SQL/через Supabase Studio.
* Нагрузочное тестирование (этап 5) и ротация ранее переданных ключей — операционные
  действия на сервере.
* Боевой платный проход (этап 0) не выполнялся из этой среды — для него есть `smoke e2e`.
