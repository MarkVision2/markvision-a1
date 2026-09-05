# MCP: AI-оркестратор поверх платформы

```
Claude / GPT / Hermes ──stdio──► mcp/markvision ──API-ключ проекта──► edge `api` (/api/v1) ──► сервисы
```

AI не имеет доступа к базе, токенам площадок и ключу автоматизации: MCP-сервер знает только
`MARKVISION_API_KEY` (права `read` / `publish` / `manage`, `project_id` зашит в ключ) и адрес
`MARKVISION_API_URL`. Контракт API — `PUBLIC-API.md`; установка и конфиг — `mcp/markvision/README.md`.

## Инструменты (37)

| Группа | Инструменты |
|---|---|
| Аккаунты | `markvision_whoami`, `markvision_list_accounts`, `markvision_update_account`, `markvision_health_check`, `markvision_account_analytics` |
| Группы | `markvision_list_groups`, `markvision_create_group`, `markvision_update_group`, `markvision_delete_group` |
| Контент и публикация | `markvision_upload_media`, `markvision_create_publication`, `markvision_create_jobs`, `markvision_list_publications`, `markvision_get_publication` |
| Задания | `markvision_list_jobs`, `markvision_get_job` (трасса шагов, верификация, метрики), `markvision_cancel_job`, `markvision_retry_job` |
| Аналитика | `markvision_metrics`, `markvision_content_analytics` (score, победители), `markvision_content_analytics_item` |
| Уведомления | `markvision_notifications`, `markvision_notification_read` |
| Кампании | `markvision_list_campaigns`, `markvision_get_campaign`, `markvision_create_campaign`, `markvision_update_campaign`, `markvision_campaign_add_content`, `markvision_campaign_remove_content`, `markvision_campaign_action` |
| Вебхуки, отчёты | `markvision_list_webhooks`, `markvision_create_webhook`, `markvision_webhook_deliveries`, `markvision_daily_report` |
| Настройки | `markvision_get_settings`, `markvision_update_settings` (в т.ч. `features` — флаги проекта) |

## Policy

| Действие | Право ключа | Кто |
|---|---|---|
| чтение, аналитика, трасса, уведомления | `read` | автоматически |
| загрузка, постановка/отмена/повтор заданий, `client_ref` | `publish` | автоматически в рамках лимитов аккаунтов, окон, паузы проекта |
| правка аккаунтов/групп/настроек, живая проверка здоровья | `manage` | автоматически |
| подключение / удаление аккаунта, токены | — | недоступно через API: только человек в интерфейсе |

Аудит: каждый вызов — строка `api_request_logs` (ключ, маршрут, статус, sha256 параметров, длительность);
лимит 120 запросов/мин на ключ. Удалённый MCP (HTTP) и режимы Manual/Assisted/Automatic — Phase 4
(`ARCHITECTURE.md`).
