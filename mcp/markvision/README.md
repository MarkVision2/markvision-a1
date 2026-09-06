# markvision-mcp

MCP-сервер (stdio) для платформы MarkVision: агент (Claude Code, Claude Desktop, Cursor)
по API-ключу проекта загружает видео и ставит его в очередь публикаций.
Контракт самого API — [docs/PUBLIC-API.md](../../docs/PUBLIC-API.md).

## Установка

```bash
cd mcp/markvision
npm install
npm run build
```

Ключ выдаётся в MarkVision: **Настройки → API и MCP** (показывается один раз).

## Подключение к Claude Code

В `~/.claude.json` (или `.mcp.json` проекта):

```json
{
  "mcpServers": {
    "markvision": {
      "command": "node",
      "args": ["/полный/путь/к/markvision-a1/mcp/markvision/dist/index.js"],
      "env": {
        "MARKVISION_API_KEY": "mv_live_…",
        "MARKVISION_API_URL": "https://<проект>.supabase.co/functions/v1/api/v1"
      }
    }
  }
}
```

Claude Desktop — тот же блок в `claude_desktop_config.json`.

## Удалённый MCP по HTTP

Тот же набор инструментов по Streamable HTTP, без сессий: ключ проекта приходит в заголовке
каждого запроса, сервер ничего не хранит и обслуживает любое число проектов.

```bash
MARKVISION_API_URL=https://<проект>.supabase.co/functions/v1/api/v1 \
MARKVISION_MCP_HOST=127.0.0.1 MARKVISION_MCP_PORT=8787 npm run start:http   # → http://127.0.0.1:8787/mcp
```

Наружу — только через TLS-прокси (Caddy/nginx). Подключение из Claude Code:

```bash
claude mcp add --transport http markvision https://mcp.example.com/mcp --header "Authorization: Bearer mv_live_…"
```

Проверка: `GET /healthz` → `{ ok: true }`; запрос без `Authorization` → `401`.

## Инструменты

| Инструмент | Что делает |
|---|---|
| `markvision_whoami` | проект и права ключа |
| `markvision_list_accounts` | аккаунты площадок проекта (страница `limit`/`offset`, поиск `q`, фильтры) |
| `markvision_accounts_bulk_update` | одна правка на пачку аккаунтов: группа, персона, рутина, пояс, окно, лимит, разгон |
| `markvision_calendar` | календарь: задания по аккаунтам за период (до 31 дня) |
| `markvision_list_groups` | группы аккаунтов |
| `markvision_upload_media` | файл с диска → хранилище → `file_url` |
| `markvision_create_publication` | принять видео и поставить задания (группа / аккаунты / режим) |
| `markvision_create_jobs` | задания на уже принятое видео |
| `markvision_list_publications` | последние видео и сводка по статусам |
| `markvision_get_publication` | задания одного видео по аккаунтам |
| `markvision_cancel_job`, `markvision_retry_job` | отмена и повтор задания |
| `markvision_list_jobs` | задания очереди по статусу, страница по `offset`, фильтры по видео/аккаунту/кампании |
| `markvision_update_account` | вкл/выкл, лимит, группа, окно, разгон, статус аккаунта |
| `markvision_health_check` | живая проверка токенов у площадок |
| `markvision_create_group`, `markvision_update_group`, `markvision_delete_group` | группы аккаунтов |
| `markvision_get_settings`, `markvision_update_settings` | пауза проекта, уведомления, бюджеты |
| `markvision_metrics` | витрины публикаций, радара, аккаунтов |
| `markvision_get_job` | одно задание: статус, верификация, класс ошибки, трасса шагов воркера, журнал площадки, метрики |
| `markvision_content_analytics` | аналитика по видео во всех аккаунтах: score 0–100, победители (`winners: true`) |
| `markvision_content_analytics_item` | одно видео и его публикации по аккаунтам |
| `markvision_account_analytics` | витрина аккаунта и последние публикации с метриками |
| `markvision_notifications`, `markvision_notification_read` | центр уведомлений проекта |
| `markvision_list_campaigns`, `markvision_get_campaign`, `markvision_create_campaign`, `markvision_update_campaign` | кампании: период × аккаунты × правило публикации × очередь контента |
| `markvision_campaign_add_content`, `markvision_campaign_remove_content`, `markvision_campaign_action` | очередь кампании; start / pause / complete / archive / plan |
| `markvision_list_webhooks`, `markvision_create_webhook`, `markvision_webhook_deliveries` | подписки на события и их доставки |
| `markvision_daily_report` | отчёт за сутки |
| `markvision_list_routines`, `markvision_create_routine`, `markvision_update_routine`, `markvision_assign_routine`, `markvision_list_tasks` | рутины (проверка до публикации, метрики после) и их задачи |
| `markvision_list_members` | участники проекта и роли |
| `markvision_content_insights` | AI Content Analyst: лучшие часы и дни, площадки, аккаунты, ошибки, рекомендации |
| `markvision_list_content`, `markvision_create_variations` | темы контент-плана и варианты темы по группам через конвейер |
| `markvision_replicate_winner`, `markvision_list_replications` | автопилот: победитель → варианты в группы, где не выходил; журнал |

Чего нет намеренно: подключение и удаление аккаунтов, токены, смена политики AI и согласование
удержанных публикаций — это решения человека (`docs/MCP.md`). Публикации, поставленные агентом,
проходят политику проекта (`manual` по умолчанию → ждут согласования во вкладке «Задания»).

Типичный диалог: «загрузи `~/Movies/clip.mp4` в MarkVision и опубликуй в группу «Стоматологии» по капле с завтрашнего утра».

## Проверка

```bash
npm run typecheck
npm test
```
