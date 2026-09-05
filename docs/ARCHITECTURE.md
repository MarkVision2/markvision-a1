# Social Content Factory OS — архитектура, аудит, план

Документ отвечает на ТЗ «Развитие существующей платформы в Social Content Factory OS»:
что уже есть в MarkVision, что из ТЗ реализовано, где слабые места и в каком порядке
ядро доводится до целевого состояния. Факты сверены с кодом на 2026‑09‑05 (ветка
`claude/social-content-factory-audit-wqb6tq`). Смежные документы: `DATABASE.md`,
`CONNECTORS.md`, `JOBS.md`, `MCP.md`, `ENVIRONMENT.md`, `DEPLOY.md`,
`PUBLISHING-SYSTEM.md`, `AUTOPOSTING-PLATFORM.md`, `PUBLIC-API.md`.

## 1. Что существует (карта)

```
Пользователи (Supabase Auth, user_roles admin/manager, team_member_modules)
        │
        ▼
Vite + React (Vercel, www.markvision.kz) ── страницы: Контент-завод, Контент-план,
        │   Радар идей, Публикации (аккаунты/группы/персоны/задания/настройки), Настройки
        ▼
Supabase (проект szfgdruhlebfvcmlvxdk): Postgres + RLS, Storage, Edge Functions (Deno), pg_cron
        │
        ├─ publish-accounts   — реестр аккаунтов, группы, персоны, настройки, задания, API-ключи
        ├─ publish-oauth      — OAuth Threads / TikTok / YouTube (state в publish_oauth_states)
        ├─ facebook-oauth-*   — Meta OAuth → Instagram Business через страницу
        ├─ publish-intake     — приём видео + plan_publish_slots (планировщик слотов)
        ├─ publish-worker ×3  — забор claim_publish_jobs (партиции), раннер publishRunner
        ├─ publish-dispatch   — разовая публикация / выполнение задания по HTTP
        ├─ publish-monitor    — tokens / errors / health / digest
        ├─ publish-metrics    — статистика постов по контрольным точкам → post_metrics
        ├─ api (/api/v1)      — публичный API по ключу проекта (api_keys, sha256)
        ├─ radar, content-pipeline, montage-worker, reels-tts — генерация контента
        └─ _lib/publishers/{instagram,threads,tiktok,youtube}.ts — вызовы API площадок
        │
        ▼
Хранилище: bucket publish-uploads (≤ 50 МБ), Cloudflare R2 через r2-presign-upload (≤ 2 ГБ)
Внешние исполнители: n8n (заявки, отчёты), Telegram (уведомления), Apify (радар)
MCP: mcp/markvision (stdio) → /api/v1
```

Очередь — Postgres (`publish_jobs` + `claim_publish_jobs` с `FOR UPDATE SKIP LOCKED`,
аренда `locked_at`), тики — pg_cron → edge-функции. Redis/BullMQ/Docker в проекте нет и
не нужны: очередь на Postgres уже даёт lock, lease, retry, партиции и переживает падение
воркера (`claim` возвращает просроченные аренды в очередь).

## 2. Соответствие ТЗ: EXISTS / PARTIAL / MISSING

| Раздел ТЗ | Состояние | Что есть сейчас | Действие |
|---|---|---|---|
| 3. Multi-tenant | **PARTIAL** | Тенант = `project_id` на всех таблицах, RLS через `user_can_access_project`. Слоя Workspace/Organization нет | Оставить `project_id` как tenant id (переименование = переписать 200 миграций ради слова). Organization — Phase 2 как надстройка над проектами |
| 4–5. Account Registry | **EXISTS, улучшить** | `publish_accounts` (+`publish_accounts_safe`), группы, здоровье 0–100 с причинами, лимиты, окна, разгон, персоны, bulk-панель в UI | Добавлены `capabilities`, `connection_type`, `auth_status` (миграция `20260908140000`) |
| 6–7. OAuth flow | **EXISTS** | Meta (facebook-oauth-*), Threads/TikTok/YouTube (`publish-oauth`, одноразовый state TTL 15 мин, token exchange только на сервере) | PKCE для TikTok — Phase 2; универсальный `OAuthProvider` — уже де-факто в `_lib/publishOAuth.ts` (buildAuthorizationUrl / exchange / refresh / identity) |
| 8. Token management | **EXISTS** | AES‑GCM `v1:` в колонках `*_encrypted`, ключ `PUBLISH_TOKEN_KEY` в секретах; колонки без SELECT для пользователей; refresh перед публикацией и по крону; `reconnect_required` = статус `token_expired` | Отдельная таблица `social_credentials` не заводится: колонки уже изолированы грантами. Ротация ключа (`v2:`) — Phase 2 |
| 9. Capability system | **MISSING → добавлено** | Возможности были зашиты в код | `_lib/publishCapabilities.ts` + `publish_accounts.capabilities jsonb`; раннер проверяет `publish_video` перед публикацией |
| 10. Connector layer | **PARTIAL → расширено** | `Publisher = (req) => outcome` на 4 площадки, health/metrics — в других функциях | `_lib/connectors/`: `SocialConnector { publish, getPublication, capabilities }` поверх публикаторов + `MockSocialConnector` (только вне production) |
| 11–14. Content Library | **PARTIAL** | `publish_videos` (медиа для очереди), `content_plan_items` (редплан, варианты через `parent_item_id`), `content_assets` (версии артефактов) | Не сливать в одну таблицу сейчас: три жизненных цикла. Phase 2 — витрина `content_items` (view) + метаданные (`topic`, `hook_type`, `cta_type`) в `publish_videos` |
| 15. Media processor | **PARTIAL** | Проверка ссылки/типа/веса/длительности при приёме (`publishSchedule.ts`), ffmpeg-нормализация только в content-worker | Phase 2: `MEDIA_PREPARE` как отдельный шаг очереди (ffprobe в worker/) |
| 16. Object storage | **EXISTS** | Storage + R2, presigned PUT | — |
| 17. Campaigns | **MISSING → добавлено** | Ближайшее было — группа + персона + режим согласования | `publish_campaigns` + очередь + SQL-планировщик по правилу «N постов в день в заданные часы» (миграция `20260908150000`), вкладка «Кампании», API, MCP |
| 18. Account groups | **EXISTS** | `publish_account_groups`, bulk-назначение | — |
| 19–21. Scheduler | **EXISTS, дополнено** | `plan_publish_slots` / `publish_next_slot`: окна, интервалы, дневной лимит с разгоном, джиттер, режимы now/drip/daily | Recurring-правило («3 поста в день по будням в 10/14/19») — правило кампании, крон `publish-campaign-planner-hourly` |
| 22–24. Job engine | **EXISTS, дополнено** | `publish_jobs`: pending → processing → published/retry/failed/manual_review/cancelled, попытки, аренда, контейнер площадки | Добавлен статус `verifying`, `verification_status`, `trace_id`, журнал шагов `publish_job_events` |
| 25. Queue | **EXISTS** | pg_cron ×3 партиции, `SKIP LOCKED`, backoff, DLQ = `failed`/`manual_review` с кнопками повтор/отмена | — |
| 26. Idempotency | **EXISTS, дополнено** | `UNIQUE(video_id, account_id)`, `container_id` до публикации, dispatch не трогает занятое воркером | Ключ идемпотентности клиента на `POST /publications` (`client_ref`) |
| 27–29. Execution router | **PARTIAL** | Один исполнитель — официальный API | Введён `connectorFor(platform)`; выбор device/human — Phase 3 (когда появится DeviceProvider) |
| 30–33. Device engine | **MISSING (осознанно)** | Решение проекта: браузерной автоматизации нет | Phase 3 |
| 34–35. Routines | **MISSING → добавлено** | Кроны как «рутина» были зашиты в миграции | `publish_routines` (шаги относительно публикации) → `publish_tasks` → воркер `publish-tasks`; назначение аккаунту/группе/проекту; секция «Рутины» (миграция `20260908160000`) |
| 36–37. Publication model | **PARTIAL** | Публикация = строка `publish_jobs` (external_post_id/url, published_at) | Не дублировать в отдельную таблицу: одна строка = одна публикация на аккаунт; витрина `publish_publications` даёт «модель публикации» без переноса данных |
| 38–39. Verification | **MISSING → добавлено** | Успех = ответ API площадки | `verifying` → `getPublication()` → `published` только после подтверждения; без подтверждения — `unverified` + уведомление |
| 40–42. Error classification, retry, DLQ | **PARTIAL → добавлено** | `FailureKind` token/limit/temporary/fatal/unsupported + сырой код площадки | Канонические коды (`AUTH_EXPIRED`, `RATE_LIMIT`, `MEDIA_INVALID`, …) в `publish_jobs.error_class`, retry policy с jitter — `_lib/publishPolicy.ts` |
| 43–46. Analytics, snapshots | **PARTIAL → расширено** | `post_metrics` d1/d3/d7, `publish_account_metrics`, `publish_metrics` | Добавлены точки `h1`, `h6`; витрина `publish_content_metrics` (по видео, сумма по всем публикациям) со скорингом |
| 47–49. Dashboards | **PARTIAL** | Сводка страницы «Публикации» | Job Monitor: счётчики статусов и трейс задания |
| 50. Winner detection | **MISSING → добавлено (MVP)** | — | `publish_performance_score()` (детерминированный, взвешенный) + `is_winner` = top‑10 % проекта в витрине |
| 51–57. AI orchestrator, MCP, policy, audit | **PARTIAL** | MCP stdio (18 инструментов), ключи с правами read/publish/manage, sha256, лимит 120/мин; аудита вызовов нет | Добавлен журнал `api_request_logs` (кто/что/когда через ключ) + инструменты аналитики/трейса; policy = scopes ключа; удаление аккаунта через API недоступно (человек) |
| 58–59. API v1 | **EXISTS** | `/api/v1/…` | Добавлены `/jobs/:id`, `/analytics/*`, `/notifications` |
| 60. Webhooks (исходящие) | **MISSING** | Входящие подписанные callback'и есть | Phase 2 (`publish_webhooks` + доставка из воркера событий) |
| 61. Event-driven | **PARTIAL** | Триггеры БД (учёт аккаунта), кроны | Журнал событий задания — основа для уведомлений/вебхуков |
| 62–63. Notification center, daily report | **PARTIAL → добавлено** | Telegram дайджест раз в час | `publish_notifications` (reconnect, ошибка, unverified, campaign.completed) + UI/API; ежедневный отчёт `publish-monitor mode:daily_report` (Telegram, уведомление, `GET /reports/daily`) |
| 64. Календарь | **EXISTS (редплан)** | `/marketing/content-plan?view=calendar` | Календарь публикаций по аккаунтам — Phase 2 |
| 65–66. Bulk, фильтры | **EXISTS** | Панель массовых действий, фильтры площадка/группа/внимание | Серверная пагинация — при > 500 аккаунтов (Phase 2) |
| 67–68. Health | **EXISTS** | `publishHealth.ts`, формула 0–100, крон 6 ч | — |
| 69–71. Observability | **MISSING → добавлено** | `publish_logs` (сырой ответ), нет trace/request id, Sentry нет | `trace_id` у задания, `publish_job_events` (шаги), структурные console-логи JSON |
| 72. Security review | **EXISTS** | Секреты в Supabase secrets, hardening 20260907 | Замечания — раздел 4 |
| 73. RBAC | **PARTIAL → добавлено** | Глобальные роли команды + модули доступа; `project_members.role` не использовалась | Роли owner/admin/manager/content_manager/operator/viewer (`_lib/rbac.ts`, `project_role_of`), гейт каждого действия `publish-accounts`, секция «Роли в проекте», `member_role_set` |
| 74–76. Rate limits, locks | **EXISTS** | Лимиты площадок в публикаторах, `daily_limit`, аренда | — |
| 77–79. Scaling, concurrency | **EXISTS** | Партиции воркера (добавить кроны `p3…`), `max_parallel_workers` | — |
| 80–81. Environments, flags | **PARTIAL → добавлено** | Один прод-проект; флагов не было | Mock-коннектор только переменной окружения; флаги проекта — `publish_project_settings.features` (`ai_autopublish_enabled`, `winner_replication_enabled`, `tiktok_direct_publish_enabled`, `phonegrid_enabled`), по умолчанию выключены |
| 82–88. AI content factory | **PARTIAL** | Радар → идея → контент-план → конвейер (HeyGen/Reels) → варианты по группам → согласование → публикация → метрики → `outcome_score` | Winner replication — Phase 4 |
| 93–94. Миграции, совместимость | **EXISTS** | Только миграции, идемпотентные, CI-проверка версий | — |
| 99–100. Тесты, mock | **PARTIAL → расширено** | vitest на чистых модулях, deno test на `api` | Тесты policy/capabilities/verification/score; `MockSocialConnector` |

## 3. Слабые места (найдено аудитом)

1. **Публикация считалась успешной по ответу API** — без чтения поста обратно. Исправлено (раздел 5).
2. **Нет трассы задания**: `publish_logs` хранит сырые ответы без шагов и `trace_id`; нельзя восстановить цепочку api → intake → worker → площадка. Исправлено.
3. **TikTok**: при пустом `publicaly_available_post_id` в `external_post_id` попадал внутренний `publish_id` — метрики по нему не собираются. Верификация теперь помечает такое как `unverified`.
4. **Ошибки — сырые коды площадок** (`190`, `spam_risk_too_many_posts`, …), фронту и AI нечего агрегировать. Добавлен канонический `error_class`.
5. **RLS-предикат `projects_select_authed USING (true)`**: любой авторизованный видит список проектов; `montage_jobs`/`reels_jobs` с предикатом `project_id IN (SELECT id FROM projects)` фактически не изолированы. Ядро публикаций (`publish_*`) изолировано корректно. Требует отдельной миграции с проверкой на проде (Phase 2, риск сломать Lovable-экраны).
6. **`project_members.role` — свободный текст и никем не читается**; авторизация бинарная. RBAC из ТЗ — Phase 2.
7. **Лимит API-ключей в памяти изолята** — «120/мин» не глобален. Достаточно для MCP, но при внешних клиентах — перенести в таблицу.
8. **Ретеншн журналов не настроен** — `publish_logs` растут бесконечно. Добавлен GC для событий/логов (90 дней, настраиваемо).
9. **Один ключ шифрования без ротации** — `v1:` префикс позволяет ввести `v2:` без миграции данных.
10. **Публикаторы дублируют выбор графа по форме токена** (`/^IG/`) в трёх файлах — вынесено в коннектор.
11. Кроны `meta-daily-sync`, `google-ads-daily-sync`, `crm-automations` бьют в устаревшие project ref — не относится к публикациям, но требует отдельной чистки.

## 4. Потенциальные конфликты

- Статус `verifying` — новый для `publish_jobs`: витрины `publish_metrics`/`publish_group_metrics` считают его как «в работе» (не `published`), `settleVideo` считает открытым, `claim_publish_jobs` его не забирает. Фронт получил метку и действия (повтор/отмена только при зависшей аренде).
- Триггер учёта аккаунта (`published_today`, `last_post_at`) срабатывает при переходе `verifying → published`, а не сразу после ответа площадки: дневной лимит учтётся с задержкой до ~2 минут. При отказе верификации (пост не найден, `unverified`) задание всё равно переходит в `published` — повторная публикация дала бы дубль.
- `post_metrics_due` — новые точки `h1`/`h6` увеличивают частоту вызова API площадок (2 дополнительных запроса на пост). Крон метрик остаётся раз в 6 часов, поэтому `h1` фактически снимается «первым прогоном после публикации» — честнее назвать это «ранняя точка».
- Legacy-контур `cf_scheduled_posts` + edge `publisher` (один Instagram на проект) не трогаем — отдельная дорога, как и раньше.

## 5. Что сделано в этом заходе (Phase 1: ядро)

Миграция `supabase/migrations/20260908140000_content_factory_core.sql` (идемпотентна):

- `publish_jobs`: статус `verifying`; `verification_status` (`pending|verified|unverified|skipped`), `verified_at`,
  `verify_attempts`, `error_class` (канонический код), `trace_id`, `client_ref` у `publish_videos`
  (идемпотентность API, `UNIQUE (project_id, client_ref)`).
- `publish_accounts`: `capabilities jsonb`, `connection_type` (`oauth|device|hybrid`), `auth_status`
  (`connected|expiring|expired|reconnect_required`) — заполняется монитором здоровья.
- `publish_job_events` — трасса задания (`step`, `level`, `message`, `data`, `trace_id`), RLS по проекту, GC 90 дней.
- `publish_notifications` — центр уведомлений (`kind`, `severity`, `title`, `body`, `entity`, `dedupe_key`, `read_at`).
- `api_request_logs` — аудит вызовов публичного API/MCP (ключ, маршрут, статус, хэш параметров), GC 90 дней.
- `post_metrics`: точки `h1`, `h6`; `post_metrics_due` учитывает их.
- `publish_performance_score(...)` + витрина `publish_content_metrics` (по видео: публикаций, сумма/среднее
  просмотров, охват, реакции, лучший аккаунт, score, `is_winner` = верхние 10 % проекта).
- `claim_publish_verifications(p_batch)` — атомарный забор заданий на верификацию.
- Крон `publish-maintenance-daily` — GC журналов.

Backend:

- `_lib/publishPolicy.ts` — канонические коды ошибок, решение по повтору (backoff + jitter), чистый модуль.
- `_lib/publishCapabilities.ts` — возможности аккаунта по площадке/типу токена/scope.
- `_lib/publishTrace.ts` — шаги трассы (`publish_job_events` + структурный лог).
- `_lib/connectors/` — `SocialConnector` (publish / getPublication / capabilities) для 4 площадок + Mock.
- `publishRunner.ts` — проверка capability, `verifying` после ответа площадки, `verifyPublishJob()`;
  `publish-worker` — второй проход: верификация.
- `publish-monitor mode:health` — пишет `auth_status`, уведомление `account.reconnect_required`.
- `api` — `GET /jobs/:id`, `GET /analytics/content`, `GET /analytics/content/:id`, `GET /analytics/accounts/:id`,
  `GET /notifications`, `POST /notifications/:id/read`, `client_ref` в `POST /publications`, аудит вызовов.
- `publish-accounts` — `job_get` (задание + трасса), `notifications_list`, `notification_read`.
- MCP — `markvision_get_job`, `markvision_content_analytics`, `markvision_account_analytics`, `markvision_notifications`.

Frontend: вкладка «Задания» — статус «Проверяется», отметка верификации, панель задания с таймлайном
шагов; блок уведомлений на странице «Публикации».

## 5a. Второй заход (Phase 2, миграция `20260908150000`)

- **Кампании**: `publish_campaigns` + очередь `publish_campaign_items`; правило «N постов в день в заданные
  часы по дням недели», `fanout` (видео во все аккаунты) / `spread` (по кругу); SQL-планировщик
  `plan_publish_campaigns` ежечасно на сегодня и завтра, идемпотентный; автозавершение; витрина;
  вкладка «Кампании», `/api/v1/campaigns/*`, 7 MCP-инструментов.
- **Исходящие вебхуки**: `publish_webhooks` + `publish_webhook_deliveries`, события из триггеров, edge
  `publish-webhooks` (HMAC-SHA256, повторы 1→5→15→60→180 мин), секция в настройках, API, MCP.
- **Ежедневный отчёт** и **feature flags** проекта.

## 5b. Третий заход (миграция `20260908160000`)

- **RBAC**: роль в проекте из владения, `project_members.role` и глобальной роли команды; матрица
  уровней read/operate/publish/manage/admin; гейт каждого действия в `publish-accounts`; управление
  ролями владельцем/администратором (UI, `POST /api/v1/members/:id/role`).
- **Routine Engine**: рутины как данные, задачи в `publish_tasks`, воркер `publish-tasks`, ранние
  метрики `r<N>m`, задачи в трассе задания; API `/routines/*`, `/tasks`, 6 MCP-инструментов.

## 6. План дальше (по приоритету)

**Phase 2 — остаток.** Серверная пагинация аккаунтов и заданий; календарь публикаций по аккаунтам;
ужесточение `projects_select_authed`; массовый онбординг аккаунтов (batch assignment после подключения).

**Phase 3 — Device engine.** `DeviceProvider` (PhoneGrid/Multilogin) как отдельный сервис только для
health-check / native-only сценариев; `secondary_executor` у аккаунта; Execution Router выбирает
исполнителя по capability и policy.

**Phase 4 — AI + MCP.** Удалённый MCP (HTTP) поверх `/api/v1`, policy Manual/Assisted/Automatic на
уровне проекта, `content_create_variations` через конвейер, AI Content Analyst по `publish_content_metrics`.

**Phase 5 — автономная фабрика.** Winner → варианты → согласование по policy → публикация → метрики.

## 7. Нагрузочная проверка

`MockSocialConnector` включается переменной `PUBLISH_MOCK_CONNECTOR=1` **и** только для аккаунтов с
`external_account_id`, начинающимся на `mock:` — на боевом проекте без переменной mock недостижим.
Сценарий: 100 mock-аккаунтов × 3 публикации/день → `plan_publish_slots` → воркер → верификация →
метрики — раздел «Нагрузочный тест» в `JOBS.md`.
