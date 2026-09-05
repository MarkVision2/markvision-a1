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

Ключ выдаётся в MarkVision: **Публикации → Настройки → API-ключи** (показывается один раз).

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

## Инструменты

| Инструмент | Что делает |
|---|---|
| `markvision_whoami` | проект и права ключа |
| `markvision_list_accounts` | аккаунты площадок проекта |
| `markvision_list_groups` | группы аккаунтов |
| `markvision_upload_media` | файл с диска → хранилище → `file_url` |
| `markvision_create_publication` | принять видео и поставить задания (группа / аккаунты / режим) |
| `markvision_create_jobs` | задания на уже принятое видео |
| `markvision_list_publications` | последние видео и сводка по статусам |
| `markvision_get_publication` | задания одного видео по аккаунтам |
| `markvision_cancel_job`, `markvision_retry_job` | отмена и повтор задания |
| `markvision_list_jobs` | задания очереди по статусу |
| `markvision_update_account` | вкл/выкл, лимит, группа, окно, разгон, статус аккаунта |
| `markvision_health_check` | живая проверка токенов у площадок |
| `markvision_create_group`, `markvision_update_group`, `markvision_delete_group` | группы аккаунтов |
| `markvision_get_settings`, `markvision_update_settings` | пауза проекта, уведомления, бюджеты |
| `markvision_metrics` | витрины публикаций, радара, аккаунтов |

Типичный диалог: «загрузи `~/Movies/clip.mp4` в MarkVision и опубликуй в группу «Стоматологии» по капле с завтрашнего утра».

## Проверка

```bash
npm run typecheck
npm test
```
