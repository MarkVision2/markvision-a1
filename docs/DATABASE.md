# Database: схема контура публикаций

Единственный тенант — `project_id` (RLS через `user_can_access_project`). Все таблицы — миграциями
`supabase/migrations/2026090*`; изменения только миграциями, `drop table` не используется.

## Таблицы

| Таблица | Роль | Ключевые поля |
|---|---|---|
| `publish_accounts` | реестр аккаунтов + шифрованные токены | `platform`, `external_account_id`, `status` (`active|token_expired|limited|error|disabled`), `auth_status` (`connected|expiring|expired|reconnect_required`), `connection_type` (`oauth|device|hybrid`), `capabilities jsonb`, `health_score`, `health_reasons`, `daily_limit`, окно/пояс/разгон, `group_id`, `persona_id`, `oauth_scope`, `access_token_encrypted` / `refresh_token_encrypted` (AES-GCM `v1:`, SELECT не выдан) |
| `publish_accounts_safe` (view) | то же без шифротекста | для интерфейса |
| `publish_account_groups` | группы | стратегия, темп, окно, `review_mode` (`review_required|auto_publish|paused`), персона |
| `personas` | tone of voice, движок по умолчанию | |
| `publish_videos` | библиотека медиа для очереди | `file_url`, `title`, `base_caption`, `caption_variants`, `hashtags`, `status` (`ready|queued|publishing|done|failed`), `source`, `source_ref`, `client_ref` (UNIQUE в проекте), `topic_key`, `hook_type`, `cta_type`, `source_video_id` (родословная вариантов), `batch_id` |
| `publish_replications` | автопилот победителей | `content_id` × `group_id` (UNIQUE), `item_id` (корневая тема), `child_item_id` (вариант), `status` (`created|skipped|failed`), `reason`, `created_by` (`autopilot|api|ui`) |
| `publish_jobs` | одно задание = одна публикация в одном аккаунте | `status` (см. `JOBS.md`), `attempts`, `poll_count`, `locked_at`, `container_id`, `external_post_id/url`, `published_at`, `verification_status`, `verified_at`, `verify_attempts`, `error_code` (`awaiting_approval` — удержано политикой AI), `error_class`, `error_message`, `trace_id`, `metrics_unavailable_reason`, `origin` (`api` — из публичного API / MCP), `campaign_id`; `UNIQUE (video_id, account_id)` |
| `publish_slots` | брони планировщика | `UNIQUE (account_id, slot_at)` |
| `publish_job_events` | трасса шагов | `job_id`, `trace_id`, `step`, `level`, `message`, `data` |
| `publish_logs` | сырые ответы площадок | `job_id`, `level`, `message`, `raw_response` |
| `post_metrics` | снапшоты метрик публикации | `checkpoint` (`h1|h6|d1|d3|d7|manual`), `views, reach, likes, comments, shares, saves, followers`; `UNIQUE (job_id, checkpoint)` |
| `publish_notifications` | центр уведомлений | `kind`, `severity`, `title`, `body`, `entity_type/id`, `dedupe_key` (UNIQUE), `read_at` |
| `api_keys` | ключи публичного API | `key_hash` (sha256), `scopes`, `expires_at`, `revoked_at` |
| `api_request_logs` | аудит вызовов API/MCP | `api_key_id`, `route`, `status`, `params_hash`, `duration_ms` |
| `publish_campaigns` / `publish_campaign_items` | кампании и их очередь контента | `status` (`draft|active|paused|completed|archived`), `start_date`, `end_date`, `group_id`, `account_ids`, `posts_per_day`, `slot_times`, `weekdays`, `mode`, `distribution`; items: `status` (`queued|planned|skipped`), `planned_at`, `jobs_count`; `publish_jobs.campaign_id` |
| `publish_webhooks` / `publish_webhook_deliveries` | исходящие вебхуки | `url`, `events`, `secret_encrypted` (SELECT не выдан); доставки: `status` (`pending|retry|delivered|failed`), `attempts`, `next_attempt_at`, `response_status` |
| `publish_routines` / `publish_tasks` | рутины и их задачи | `steps jsonb`, `is_default` (одна на проект); tasks: `task_type` (`ACCOUNT_HEALTH_CHECK|TOKEN_CHECK|METRICS_SYNC`), `run_at`, `status` (`pending|running|done|failed|skipped`); `publish_accounts.routine_id`, `publish_account_groups.routine_id` |
| `project_members` | участие и роль в проекте | `role` (`admin|manager|content_manager|operator|viewer`, legacy `member`); `project_role_of(project)` |
| `publish_oauth_states` | одноразовый state OAuth | TTL 1 ч (GC) |
| `publish_project_settings`, `project_budgets`, `usage_ledger` | пауза, уведомления, бюджеты, расход | `paused`, `features jsonb`, `ai_policy` (`manual|assisted|automatic`), `ai_daily_limit` |

## Витрины (security_invoker, читаются `authenticated`)

- `publish_metrics` — проект: аккаунты, очередь (`jobs_processing` включает `verifying`), 24 ч, здоровье, охват, расход, пауза.
- `publish_group_metrics`, `publish_account_metrics` — по группе / аккаунту (последняя контрольная точка каждого поста).
- `publish_publications` — модель публикации: задание в `verifying|published` + аккаунт + видео + последняя точка метрик + `score`.
- `publish_campaign_metrics` — по кампании: годные аккаунты, очередь, задания по статусам, ближайший слот, просмотры/охват/реакции.
- `publish_content_metrics` — по видео: публикаций, сумма/среднее просмотров и реакций, лучший аккаунт, `score`, `is_winner` (верхние 10 % среди измеренных в проекте).

## Функции

| Функция | Назначение |
|---|---|
| `claim_publish_jobs(batch, lock_timeout, partition, partitions)` | атомарный забор: аренда, статус/здоровье аккаунта, дневной лимит с разгоном, паузы, партиции |
| `claim_publish_verifications(batch, lock_timeout)` | забор `verifying` заданий на проверку |
| `plan_publish_slots(video, group, account_ids, start, mode)` / `publish_next_slot(...)` | планировщик слотов |
| `publish_account_effective_limit(...)` | лимит с разгоном 1→2→3→N |
| `post_metrics_due(limit)` | какие публикации пора мерить (`h1 h6 d1 d3 d7`; `unverified` и `metrics_unavailable_reason` исключены) |
| `publish_performance_score(views, reach, likes, comments, shares, saves, followers)` | детерминированный score 0–100 |
| `plan_campaign_day(campaign, day)` / `plan_publish_campaigns(days_ahead)` / `publish_campaign_accounts(campaign)` / `publish_campaign_slot_times(...)` | планировщик кампаний |
| `publish_emit_event(project, event, payload)` / `claim_webhook_deliveries(batch, lock_timeout)` | вебхуки |
| `publish_routine_for_account(account)` / `publish_tasks_materialize(job, phase)` / `claim_publish_tasks(batch, lock_timeout)` | рутины |
| `project_role_of(project)` | роль текущего пользователя (RBAC) |
| `publish_maintenance_gc(...)` | ретеншн журналов (+ доставки вебхуков 30 дней) |
| `project_spend` / `project_budget_ok` | бюджеты |

## Триггеры

- `publish_jobs_account_bookkeeping` — при `published`: `published_today`, `last_post_at`, здоровье +1; `failed` −10; `retry` после сбоя −3; `failed|cancelled` освобождают слот.
- `trg_publish_jobs_routine_tasks` — материализация шагов рутины в `publish_tasks` (до — при создании/переносе, после — при `published`).
- `trg_publish_jobs_emit_events`, `trg_publish_notifications_emit_events`, `trg_publish_campaigns_emit_events` — события вебхуков и уведомление о завершении кампании (no-op, если в проекте нет вебхуков).
- `publish_accounts_health_on_status` — штрафы здоровья по статусу, если формула не задала `health_score` тем же UPDATE.

## Кроны (pg_cron)

`publish-worker-p0..p2` (ежеминутно), `publish-monitor-tokens-daily` 06:00, `publish-monitor-errors-quarterly` */15,
`publish-monitor-health-6h` 40 */6, `publish-monitor-digest-hourly` 5 *, `publish-metrics-6h` 20 */6,
`publish-maintenance-daily` 03:50, `publish-campaign-planner-hourly` 10 *, `publish-webhooks-minutely` (только при due-доставках),
`publish-monitor-daily-report` 05:00, `publish-tasks-minutely` (только при due-задачах), `content-pipeline-maintenance` */10, `radar-maintenance` */15.

## Индексы, которые держат нагрузку

`publish_jobs (scheduled_at, next_attempt_at) WHERE status IN (pending,retry,processing)`, `(project_id, status)`,
`(next_attempt_at) WHERE status='verifying'`, `(account_id, published_at) WHERE published`, `(trace_id)`;
`publish_job_events (job_id, created_at)`, `(project_id, created_at)`; `post_metrics (project_id, captured_at)`,
`(account_id, checkpoint)`; `publish_notifications (project_id) WHERE read_at IS NULL`;
`publish_accounts (project_id, platform)`, частичный `ready`.

## Локальная проверка миграций

Postgres 16 со стабами (`auth.uid`, `cron`, `net`, `projects`, `user_can_access_project`) применяет цепочку
`20260901160000 → … → 20260909170000` дважды без ошибок; сценарий: план 3 аккаунтов → claim → verifying →
claim_publish_verifications → published (учёт аккаунта) → `post_metrics_due` (h1) → витрины → GC.
