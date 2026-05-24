---
name: n8n-admin
description: Полное управление n8n через REST API — CRUD на workflows, executions, credentials, tags, users, projects, variables. Используй, когда нужно создать/обновить/удалить/активировать workflow или работать с другими ресурсами n8n. Не путать с MCP-tool `mcp__*__execute_workflow` (тот умеет только запускать и читать).
---

# n8n Admin Skill

Прямой доступ к n8n Public REST API через bash-обёртку. Покрывает то, чего нет в MCP-сервере: `create`, `update`, `delete`, `activate`, executions, credentials, tags, users, projects, variables.

## Предусловия

1. **API key** хранится в `.claude/n8n.env` (gitignore'd) как `N8N_API_KEY` + `N8N_BASE_URL`.
2. **Network allowlist** окружения должен разрешать домен n8n (например `n8n.zapoinov.com`). Если получаешь `HTTP 403 Host not in allowlist` — попроси пользователя добавить домен в Settings → Environment → Network в Claude Code на web.
3. `curl` и `jq` доступны в окружении.

## Использование

Все команды выполняются через одну точку входа:

```bash
bash .claude/skills/n8n-admin/n8n.sh <command> [args...]
```

Список команд: `bash .claude/skills/n8n-admin/n8n.sh help`

### Наиболее частые операции

| Команда | Описание |
| --- | --- |
| `list-workflows [--active true\|false] [--name SUBSTR] [--limit N]` | Список workflows |
| `get-workflow <id>` | Полный JSON workflow |
| `create-workflow <file.json>` | Создать workflow из JSON-файла |
| `update-workflow <id> <file.json>` | Перезаписать workflow (PUT) |
| `delete-workflow <id>` | Удалить |
| `activate <id>` / `deactivate <id>` | Вкл/выкл триггеры |
| `list-executions [--workflow-id ID] [--status success\|error\|waiting] [--limit N]` | Список запусков |
| `get-execution <id> [--include-data]` | Детали запуска |
| `delete-execution <id>` | Удалить запись запуска |
| `list-credentials-schema <type>` | Схема для credentials типа |
| `create-credential <file.json>` | Создать credential |
| `delete-credential <id>` | Удалить credential |
| `list-tags` / `create-tag <name>` / `update-tag <id> <name>` / `delete-tag <id>` | Теги |
| `get-workflow-tags <id>` / `set-workflow-tags <id> <tagIds...>` | Теги у workflow |
| `list-users` / `create-user <email> <role>` / `delete-user <id>` | Пользователи |
| `list-projects` / `create-project <name>` / `delete-project <id>` | Проекты |
| `list-variables` / `create-variable <key> <value>` / `delete-variable <id>` | Переменные |
| `raw <METHOD> <PATH> [body.json]` | Любой эндпоинт напрямую |

### Паттерн редактирования workflow

n8n требует PUT с полным телом. Безопасный паттерн:

```bash
# 1. Скачать текущий workflow
bash .claude/skills/n8n-admin/n8n.sh get-workflow <ID> > /tmp/wf.json

# 2. Отредактировать (Edit-tool на /tmp/wf.json, меняя nodes/connections/settings)

# 3. Залить обратно
bash .claude/skills/n8n-admin/n8n.sh update-workflow <ID> /tmp/wf.json
```

`update-workflow` автоматически выкидывает поля, которые n8n не принимает в PUT (`id`, `active`, `createdAt`, `updatedAt`, `versionId`, `triggerCount`, `tags`, `meta`, `scopes`, `shared`, `isArchived`, `parentFolderId`, `homeProject`, `staticData`).

### Активация после редактирования

`update-workflow` НЕ меняет состояние `active`. Если редактировал активный workflow — после PUT вызови `activate <id>` повторно, чтобы n8n переcоздал webhook/cron триггеры с новой конфигурацией.

### Создание нового workflow

Минимальный шаблон:

```json
{
  "name": "Мой workflow",
  "nodes": [
    {
      "parameters": {},
      "id": "uuid-1",
      "name": "Start",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    }
  ],
  "connections": {},
  "settings": { "executionOrder": "v1" }
}
```

## Безопасность

- Ключ n8n живёт в `.claude/n8n.env` — gitignore'd, права `600`.
- Не печатай ключ в чат, не клади в git, не передавай в third-party MCP без согласия пользователя.
- Все вызовы используют HTTPS.

## Когда НЕ использовать этот skill

- Простой запуск активного workflow по webhook → используй `mcp__*__execute_workflow` (быстрее, не требует allowlist).
- Чтение списка workflow → можно через `mcp__*__search_workflows`.
- Этот skill нужен, когда требуется **изменить** workflow или работать с executions/credentials/users.
