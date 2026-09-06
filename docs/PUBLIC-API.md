# Публичный API MarkVision (автопостинг) и MCP-сервер

Внешний клиент (Claude через MCP, скрипт, n8n, другой сервис) получает **API-ключ проекта**
и через него загружает видео и ставит его в очередь публикаций. Дальше работает
существующая система: планировщик слотов, воркер, мониторинг, отчёты
(см. [PUBLISHING-SYSTEM.md](./PUBLISHING-SYSTEM.md)).

```
клиент ──(API-ключ)──▶ edge `api` ──(ключ автоматизации)──▶ publish-intake / r2-presign-upload / publish-accounts
                                                              └▶ publish_videos + publish_jobs → publish-worker → площадки
```

Функция `api` тонкая: проверяет ключ, границы проекта и права, а работу делают уже
существующие функции. Ничего из логики публикации в ней не дублируется.

## Ключи

- Выдаются в интерфейсе: **Настройки → API и MCP**. Ключ показывается один раз.
- В базе (`api_keys`) хранится только sha256-хэш; в списке виден префикс `mv_live_XXXX…`.
- Ключ привязан к **одному проекту**. `project_id` в запросах не передаётся и не принимается.
- Права: `read` (аккаунты, группы, настройки, статусы), `publish` (загрузка медиа, постановка
  и управление заданиями) и `manage` (правка аккаунтов, групп, настроек проекта, живая проверка
  здоровья). `publish` и `manage` включают `read`. В интерфейсе — три пресета: полный доступ,
  чтение и публикация, только чтение.
- Отзыв — мгновенный, восстановить нельзя. Можно задать срок жизни (`expires_days`).
- Лимит: 120 запросов в минуту на ключ (ответ `429` + `Retry-After`).

Общий `automation_settings.cron_secret` наружу не отдаётся: он открывает все проекты и
ops-функции, им пользуются только pg_cron, n8n и сама функция `api` изнутри.

## Адрес и авторизация

```
https://<проект>.supabase.co/functions/v1/api/v1
Authorization: Bearer mv_live_…        (или заголовок x-api-key: mv_live_…)
```

Ответы — JSON. Ошибка — `{ "error": "текст по-русски" }` со статусом 400/401/403/404/422/429/500.

## Маршруты

| Метод и путь | Право | Что делает |
|---|---|---|
| `GET /me` | read | проект и права ключа |
| `GET /accounts?limit=&offset=&q=&platform=&group_id=&status=&enabled=` | read | подключённые аккаунты: id, площадка, имя, статус, `publish_enabled`, здоровье, лимит, группа, окно, `capabilities`. Без `limit` — весь список; с `limit` (≤ 500) — страница и `total`, `has_more`. `q` — поиск по имени/handle, `group_id=none` — без группы, `enabled=1|0` |
| `POST /accounts/:id` | manage | правка аккаунта: `publish_enabled, daily_limit, status, group_id, persona_id, routine_id, timezone, window_start, window_end, ramp_enabled, ramp_restart, notes` |
| `POST /accounts/bulk` | manage | одна правка на пачку (массовый онбординг): `account_ids` (≤ 500) + `patch` с теми же полями → `updated`, `missing` |
| `POST /accounts/health-check` | manage | живая проверка токенов у площадок (`account_ids?`) → `health_score` и причины |
| `GET /groups` | read | группы аккаунтов: состав, стратегия, темп, окно, режим согласования |
| `POST /groups` | manage | создать группу: `name` + любые поля группы |
| `POST /groups/:id` | manage | частичная правка группы (переданные поля заменяют текущие) |
| `POST /groups/:id/delete` | manage | удалить группу (аккаунты остаются) |
| `GET /settings` | read | пауза, уведомления, бюджеты и расход проекта |
| `POST /settings` | manage | `paused, notify_mode, digest_chat_id, daily_usd, monthly_usd` |
| `GET /jobs?status=&limit=&offset=&video_id=&account_id=&campaign_id=` | read | задания очереди проекта: страница по `offset` (≤ 500 за раз), `counts` по всей очереди, `has_more` |
| `GET /calendar?from=&to=&group_id=&account_ids=a,b` | read | календарь: аккаунты и задания за период (до 31 дня) — что и когда выходит в каждом аккаунте; `truncated`, если заданий больше 2000 |
| `GET /metrics` | read | витрины публикаций, радара, видео, групп и аккаунтов |
| `POST /media/upload-url` | publish | presigned-ссылка для прямой загрузки файла в R2 (до 2 ГБ) |
| `POST /publications` | publish | принять видео по ссылке и (если есть цель) поставить задания |
| `GET /publications?limit=20` | read | последние видео и сводка заданий по статусам |
| `GET /publications/:id` | read | видео, сводка и задания по аккаунтам |
| `POST /publications/:id/jobs` | publish | задания на уже принятое видео |
| `POST /publications/distribute` | publish | пачка принятых видео по сети: один ролик → один аккаунт |
| `POST /jobs/:id/cancel` | publish | отменить не ушедшее задание |
| `POST /jobs/:id/retry` | publish | вернуть упавшее задание в очередь |
| `GET /jobs/:id` | read | задание целиком: статус, верификация, `error_class`, трасса шагов (`events`), журнал площадки (`logs`), снятые метрики |
| `GET /analytics/content?limit=&winners=1` | read | витрина по видео: публикаций, сумма/среднее просмотров, реакции, лучший аккаунт, `score` 0–100, `is_winner` |
| `GET /analytics/content/:id` | read | одно видео и его публикации по аккаунтам с последней точкой метрик |
| `GET /analytics/accounts/:id` | read | витрина аккаунта (`publish_account_metrics`) и последние публикации |
| `GET /notifications?unread=1&limit=` | read | центр уведомлений проекта (`unread` — счётчик непрочитанных) |
| `POST /notifications/:id/read` | read | отметить уведомление прочитанным |
| `GET /campaigns` | read | кампании проекта с метриками (`publish_campaign_metrics`) |
| `POST /campaigns` | publish | создать кампанию: `name`, `objective`, `start_date`, `end_date`, `timezone`, `group_id`, `account_ids`, `posts_per_day`, `slot_times` (`["10:00","19:00"]`), `weekdays` (1..7), `mode` (`drip|now`), `distribution` (`fanout|spread`) |
| `GET /campaigns/:id` | read | кампания, очередь контента (`items`) и задания |
| `POST /campaigns/:id` | publish | частичная правка правил |
| `POST /campaigns/:id/items` | publish | `video_ids` → в очередь кампании |
| `POST /campaigns/:id/items-remove` | publish | убрать ещё не запланированные видео |
| `POST /campaigns/:id/start` \| `pause` \| `complete` \| `archive` | publish | статус; `start` сразу планирует сегодня и завтра |
| `POST /campaigns/:id/plan` | publish | спланировать ближайшие дни сейчас |
| `GET /webhooks` | read | подписки проекта |
| `POST /webhooks` | manage | создать: `name`, `url` (https), `events` (список или `["*"]`); ответ несёт `secret` один раз |
| `POST /webhooks/:id` | manage | `name`, `url`, `events`, `enabled`, `rotate_secret: true` (новый секрет в ответе) |
| `POST /webhooks/:id/delete` | manage | удалить |
| `GET /webhooks/:id/deliveries` | read | последние доставки: статус, попытки, код ответа |
| `GET /reports/daily` | read | отчёт за сутки (аккаунты, задания, успешность, просмотры за 7 дней, топ контента) |
| `GET /members` | read | участники проекта и их роли (RBAC) |
| `POST /members/:userId/role` | manage | `role`: `admin` (только владелец) \| `manager` \| `content_manager` \| `operator` \| `viewer` |
| `GET /routines` | read | рутины проекта, назначения группам/аккаунтам |
| `POST /routines` | manage | создать: `name`, `description`, `steps` (`[{action, offset_minutes}]`), `is_default` |
| `POST /routines/:id` | manage | частичная правка |
| `POST /routines/:id/assign` | manage | `group_ids`, `account_ids` |
| `POST /routines/:id/delete` | manage | удалить |
| `GET /tasks?status=&limit=` | read | задачи рутин |

### Загрузка файла

```bash
curl -X POST "$API/media/upload-url" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"filename":"clip.mp4","size":73400320,"content_type":"video/mp4"}'
# → { "upload_url": "https://…r2…?X-Amz-Signature=…", "file_url": "https://cdn…/posts/….mp4", "method": "PUT" }

curl -X PUT "<upload_url>" -H "Content-Type: video/mp4" --data-binary @clip.mp4
```

Байты идут напрямую в хранилище, минуя функции. Если видео уже лежит на публичном
https-адресе, этот шаг не нужен.

### Публикация

```bash
curl -X POST "$API/publications" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "file_url": "https://cdn…/posts/clip.mp4",
  "title": "Как выбрать имплант",
  "caption": "Три вопроса врачу перед имплантацией",
  "hashtags": ["стоматология", "импланты"],
  "caption_variants": ["Вариант подписи 2", "Вариант подписи 3"],
  "target": { "group_id": "…uuid группы…", "mode": "drip", "start_at": "2026-09-10T09:00:00+05:00" }
}'
```

Поля `target` можно передавать и плоско (`group_id`, `account_ids`, `mode`, `start_at`,
`per_hour` на верхнем уровне). Без цели видео принимается, задания создаются позже через
`POST /publications/:id/jobs` с теми же полями.

### Пачка по сети: один ролик → один аккаунт

Для контент-завода (каждый ролик уникален, сеть нужна ради пропускной способности) видео
сначала принимаются **без цели** (`POST /publications` без `group_id`/`account_ids`), а затем
раскладываются одним вызовом:

```bash
curl -X POST "$API/publications/distribute" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "videos": [{"id":"<publication id>","topic_key":"сеть-аккаунтов"}, {"id":"<…>","topic_key":"прокси"}],
  "batch_id": "2026-09-08-1",
  "target": {"group_id":"<uuid>", "per_day": 3, "start_at":"2026-09-08T09:00:00+05:00", "max_days": 30}
}'
# → { "ok": true, "created": 2, "skipped": 0, "unassigned": [],
#     "assignments": [{ "video_id": "…", "account_id": "…", "account_name": "@a", "day": 0, "scheduled_at": "…" }, …] }
```

Правила раскладки: аккаунты по кругу, здоровые вперёд; не больше `per_day` (по умолчанию 3)
роликов на аккаунт в сутки; ролики с одним `topic_key` — в разные дни и, пока есть выбор, в
разные аккаунты; точное время внутри дня — планировщик слотов (окно, интервалы, разгон).
`video_ids: […]` вместо `videos` — если ключи тем не нужны. Что не влезло в `max_days`, приходит
в `unassigned`. Чужие публикации и цели — 404 без постановки заданий. До 500 видео за вызов.

- `mode`: `now` — все сразу; `drip` (по умолчанию) — по слотам планировщика в окне аккаунта
  с минимальным интервалом и дневным лимитом; `daily` — по одному в день.
- Без `group_id` и `account_ids` задания ставятся на **все активные аккаунты проекта**.
- `caption_variants` раздаются аккаунтам по кругу, хэштеги подклеиваются к подписи.
- `client_ref` (до 200 символов) — ключ идемпотентности: повторный вызов с тем же `client_ref` в проекте
  вернёт то же `video_id` с `idempotent: true` и не заведёт второй ролик; задания по-прежнему уникальны
  на пару видео + аккаунт.
- Ответ: `{ ok, video_id, caption_preview, created, skipped, accounts: [{ id, account_name, scheduled_at }] }`.

Проверка входа: `file_url` — https на `.mp4/.mov/.m4v`; по ссылке должно лежать видео
(`content-type: video/*`) не больше 1 ГБ; `duration_sec`, если передан, — от 3 до 900 секунд
(короче площадки не принимают, ответ `422`); `mode` — из списка; `group_id`/`account_ids` — uuid;
`start_at` — ISO 8601. Чужая группа или аккаунт — `404` до постановки.

### Управление аккаунтами, группами и настройками

```bash
# выключить публикации на аккаунте и снизить лимит
curl -X POST "$API/accounts/<account uuid>" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"publish_enabled": false, "daily_limit": 1}'

# новая группа из трёх аккаунтов, по капле, 2 в час, окно 09:00–21:00
curl -X POST "$API/groups" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Стоматологии","account_ids":["…","…","…"],"publish_strategy":"drip","per_hour":2,"window_start":"09:00","window_end":"21:00"}'

# аварийная пауза проекта
curl -X POST "$API/settings" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"paused": true}'

# массовый онбординг: сотне свежих аккаунтов — группа, персона, пояс, окно, лимит, разгон одним запросом
curl -X POST "$API/accounts/bulk" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"account_ids":["…","…"],"patch":{"group_id":"…","persona_id":"…","timezone":"Asia/Almaty","window_start":"09:00","window_end":"21:00","daily_limit":2,"ramp_enabled":true}}'

# страница аккаунтов с поиском (на сети 500+ весь список не грузят)
curl "$API/accounts?limit=100&offset=200&q=dental&platform=instagram" -H "Authorization: Bearer $KEY"

# календарь на неделю
curl "$API/calendar?from=2026-09-07T00:00:00Z&to=2026-09-14T00:00:00Z" -H "Authorization: Bearer $KEY"
```

Все объекты проверяются на принадлежность проекту ключа: чужой `account_id`, `group_id`
или `job_id` дают `404`. Поля вне списка выше отбрасываются.

### Статус

`GET /publications/:id` → `publication.summary` (`{ "published": 3, "pending": 2, "failed": 1 }`)
и `publication.jobs[]` с `status, scheduled_at, published_at, external_post_url, error_code,
error_message, publish_accounts.account_name`.

Статусы заданий: `pending → processing → verifying → published`, а также `retry`, `failed`,
`manual_review`, `cancelled`. `verifying` — площадка приняла пост, воркер ещё не прочитал его обратно;
у `published` поле `verification_status` = `verified` / `unverified` / `skipped` (`docs/JOBS.md`).
Класс ошибки — `error_class` (`AUTH_EXPIRED`, `RATE_LIMIT`, `MEDIA_INVALID`, …), сырой код площадки — `error_code`.

### Аудит

Каждый вызов пишется в `api_request_logs` (ключ, маршрут, статус, sha256 параметров, длительность) —
основа AI audit log: кто, что и когда запустил через MCP.

## MCP-сервер

Пакет `mcp/markvision/` — stdio-сервер поверх этого API для Claude Code / Claude Desktop /
Cursor. Установка, конфиг и список инструментов — [mcp/markvision/README.md](../mcp/markvision/README.md).
Кнопка «Скопировать конфиг MCP» в интерфейсе выдаёт готовый JSON с ключом и адресом.

Сценарий из чата: «загрузи `~/Movies/clip.mp4` в MarkVision и опубликуй в группу
«Стоматологии» по капле с завтрашнего утра» → `markvision_upload_media` →
`markvision_list_groups` → `markvision_create_publication` → `markvision_get_publication`.

## Что не поддерживается (пока)

- **Фото и карусели.** Очередь и воркер знают только видео (`validateVideoRef`, проверка
  `content-type: video/*`). Картинки для Instagram/Threads — отдельная задача в воркере по
  каждой площадке.
- Подключение аккаунтов через API (OAuth-онбординг только из интерфейса).
- Удалённый MCP (HTTP): сейчас сервер локальный, stdio.

## Вебхуки: проверка подписи

Каждая доставка — `POST` JSON `{ event, project_id, occurred_at, data, delivery_id, attempt }` с заголовками
`X-MarkVision-Event`, `X-MarkVision-Delivery`, `X-MarkVision-Timestamp`, `X-MarkVision-Signature: t=<unix>,v1=<hex>`,
где `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Отбрасывайте `t` старше 5 минут. Ответ 2xx — доставлено;
5xx/429 — повтор (1 → 5 → 15 → 60 → 180 мин, 5 попыток); прочие 4xx — отказ без повтора. События и
их данные — `docs/JOBS.md`.

## Где код

| Что | Где |
|---|---|
| Таблица ключей | `supabase/migrations/20260907130000_api_keys.sql` |
| Аудит вызовов, уведомления, витрины аналитики | `supabase/migrations/20260909150000_content_factory_core.sql` |
| Генерация, хэш, проверка, лимит | `supabase/functions/_lib/apiKeys.ts` |
| Маршруты и разбор тела | `supabase/functions/_lib/publicApi.ts` |
| Сама функция | `supabase/functions/api/index.ts` (вход) + `handler.ts` (логика с зависимостями наружу); `verify_jwt = false` в `config.toml` |
| Выдача и отзыв ключей | `publish-accounts` → `api_key_list / api_key_create / api_key_revoke` |
| Интерфейс | `src/components/settings/ApiKeysSettings.tsx` (Настройки → API и MCP) |
| MCP-сервер | `mcp/markvision/` |
| Тесты | `src/test/apiKeys.test.ts`, `src/test/publicApi.test.ts`, `src/test/apiKeysSettings.test.tsx` (vitest); `supabase/functions/_tests/api_test.ts` (deno test, обработчик насквозь с подменённой базой и сетью); `mcp/markvision/tests/` (node --test) |

```bash
npx vitest run src/test/apiKeys.test.ts src/test/publicApi.test.ts src/test/apiKeysSettings.test.tsx
cd supabase/functions && deno test --allow-env _tests/api_test.ts
cd mcp/markvision && npm test
```

Деплой — как у всего контура: push в `main` запускает `.github/workflows/supabase-deploy.yml`
(все функции из `supabase/functions/` + `db push` миграций). Локального токена Supabase CLI
на машине нет, руками — `supabase functions deploy api publish-accounts` и `supabase db push`
с `SUPABASE_ACCESS_TOKEN`.
