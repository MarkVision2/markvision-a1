# MCP: AI-оркестратор поверх платформы

```
Claude / GPT / Hermes ──stdio──► mcp/markvision (index.js) ──API-ключ проекта──► edge `api` (/api/v1) ──► сервисы
Claude.ai / любой хост ──HTTP──► mcp/markvision (http.js, Bearer = ключ) ──┘
```

AI не имеет доступа к базе, токенам площадок и ключу автоматизации: MCP-сервер знает только
`MARKVISION_API_KEY` (права `read` / `publish` / `manage`, `project_id` зашит в ключ) и адрес
`MARKVISION_API_URL`. Контракт API — `PUBLIC-API.md`; установка и конфиг — `mcp/markvision/README.md`.

## Инструменты (51)

| Группа | Инструменты |
|---|---|
| Аккаунты | `markvision_whoami`, `markvision_list_accounts` (страница `limit`/`offset`, поиск `q`, фильтры), `markvision_update_account`, `markvision_accounts_bulk_update` (одна правка на пачку — массовый онбординг), `markvision_health_check`, `markvision_account_analytics` |
| Группы | `markvision_list_groups`, `markvision_create_group`, `markvision_update_group`, `markvision_delete_group` |
| Контент и публикация | `markvision_upload_media`, `markvision_create_publication`, `markvision_create_jobs`, `markvision_list_publications`, `markvision_get_publication` |
| Задания | `markvision_list_jobs` (страница `offset`, фильтры по видео/аккаунту/кампании), `markvision_get_job` (трасса шагов, верификация, метрики), `markvision_cancel_job`, `markvision_retry_job`, `markvision_calendar` (что и когда выходит в каждом аккаунте за период) |
| Аналитика | `markvision_metrics`, `markvision_content_analytics` (score, победители), `markvision_content_analytics_item`, `markvision_content_insights` (AI Content Analyst: часы, дни, площадки, аккаунты, ошибки, рекомендации) |
| Контент-план, автопилот | `markvision_list_content`, `markvision_create_variations` (варианты темы по группам через конвейер), `markvision_replicate_winner` (победитель → варианты в группы, где не выходил), `markvision_list_replications` |
| Уведомления | `markvision_notifications`, `markvision_notification_read` |
| Кампании | `markvision_list_campaigns`, `markvision_get_campaign`, `markvision_create_campaign`, `markvision_update_campaign`, `markvision_campaign_add_content`, `markvision_campaign_remove_content`, `markvision_campaign_action` |
| Вебхуки, отчёты | `markvision_list_webhooks`, `markvision_create_webhook`, `markvision_webhook_deliveries`, `markvision_daily_report` |
| Рутины, роли | `markvision_list_routines`, `markvision_create_routine`, `markvision_update_routine`, `markvision_assign_routine`, `markvision_list_tasks`, `markvision_list_members` |
| Настройки | `markvision_get_settings`, `markvision_update_settings` (в т.ч. `features` — флаги проекта) |

## Policy

| Действие | Право ключа | Кто |
|---|---|---|
| чтение, аналитика, трасса, уведомления | `read` | автоматически |
| загрузка, постановка/отмена/повтор заданий, `client_ref` | `publish` | автоматически в рамках лимитов аккаунтов, окон, паузы проекта |
| правка аккаунтов/групп/настроек, живая проверка здоровья | `manage` | автоматически |
| варианты темы по группам (`markvision_create_variations`) | `publish` | конвейер контента; готовый ролик — через согласование по политике |
| подключение / удаление аккаунта, токены | — | недоступно через API: только человек в интерфейсе |
| смена политики AI, согласование удержанных публикаций | — | в MCP нет; человек в интерфейсе, `POST /jobs/approve` для n8n/Telegram |

### Режимы Manual / Assisted / Automatic

`publish_project_settings.ai_policy` (Настройки → «Политика AI-публикаций»; `_lib/publishAiPolicy.ts`):
всё, что агент ставит через `markvision_create_publication` / `markvision_create_jobs` /
`markvision_distribute`, при `manual` ложится в `manual_review` (`error_code = awaiting_approval`) и ждёт
человека; при `assisted` первые `ai_daily_limit` в сутки уходят сами; при `automatic` ворот нет.
Ответ инструмента содержит `policy: { policy, auto, held }` — агент видит, что удержано, и говорит об этом
оператору. Интерфейс: вкладка «Задания» → баннер «Ждут согласования» → «Согласовать все» / «Отклонить все».

Аудит: каждый вызов — строка `api_request_logs` (ключ, маршрут, статус, sha256 параметров, длительность);
лимит 120 запросов/мин на ключ — в изоляте и глобально по журналу за последнюю минуту.

### Автопилот победителей (Phase 5)

Флаг проекта `features.winner_replication_enabled` (Настройки → «Автопилот победителей»). Раз в сутки
(`publish-monitor mode=winner_replication`, 06:50 UTC, после снятия метрик) ролики с `is_winner` и ≥ 3
измеренными публикациями размножаются вариантами по группам, где ещё не выходили
(`_lib/publishReplication.ts` → `content-pipeline /items/:id/variants`); журнал — `publish_replications`,
уведомление `winner_replicated`. Дальше ролики идут обычным путём: согласование в конвейере (или доверенная
группа `auto_publish`), политика AI, слоты. Агент может запустить то же руками — `markvision_replicate_winner`.

## Удалённый MCP (HTTP)

`mcp/markvision/src/http.ts` — Streamable HTTP без сессий: каждый запрос несёт
`Authorization: Bearer mv_live_…`, по ключу на время запроса создаётся клиент API; сервер ключей не хранит
и базы не видит. Один процесс на любое число проектов; ставится на VPS рядом с воркерами за TLS-прокси.
Переменные — `ENVIRONMENT.md`; подключение — `mcp/markvision/README.md`.
