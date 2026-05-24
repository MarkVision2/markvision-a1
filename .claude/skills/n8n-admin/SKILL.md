---
name: n8n-admin
description: Полное управление n8n через REST API — CRUD на workflows, executions, credentials, tags, users, projects, variables. Используй, когда нужно создать/обновить/удалить/активировать workflow или работать с другими ресурсами n8n. Не путать с MCP-tool `mcp__*__execute_workflow` (тот умеет только запускать и читать).
---

# n8n Admin Skill

Прямой доступ к n8n Public REST API через bash-обёртку. Покрывает то, чего нет в MCP-сервере: `create`, `update`, `delete`, `activate`, executions, credentials, tags, users, projects, variables.

## Предусловия

1. **API key** хранится в `.claude/n8n.env` (gitignore'd) как `N8N_API_KEY` + `N8N_BASE_URL`.
2. **Один из двух способов сетевого доступа:**
   - **A. Network allowlist (быстрее)**: домен `n8n.zapoinov.com` добавлен в `Custom` allowlist окружения через UI Claude Code (Settings → Environment → Network access → Custom → Allowed domains). После этого работает прямой `curl`.
   - **B. Proxy workflow в n8n (обходной)**: в n8n импортирован `proxy-workflow.template.json` (см. ниже) с API ключом, и его ID положен в `.claude/n8n.env` как `N8N_PROXY_WORKFLOW_ID`. После этого работают команды с префиксом `proxy-` ниже.
3. `curl` и `jq` доступны в окружении.

## Способ B: Proxy через MCP execute_workflow (активен)

Импортирован workflow «Claude n8n API Proxy» в n8n. Его ID записан в `.claude/n8n.env` как `N8N_PROXY_WORKFLOW_ID`.

**Текущий рабочий ID**: `uj5DcNatRXYqNkoO` (проверено: ответ 200, см. executionId 40124).

Любой CRUD к n8n API делается через MCP-tool `mcp__*__execute_workflow` (`mcp__3e0c15f0-c6b2-46a6-aa32-bed2394a57a3__execute_workflow` в этом окружении):

```jsonc
// Универсальный шаблон
{
  "workflowId": "uj5DcNatRXYqNkoO",
  "inputs": {
    "type": "webhook",
    "webhookData": {
      "method": "POST",
      "body": {
        "method": "GET | POST | PUT | PATCH | DELETE",
        "path": "/workflows | /workflows/{id} | /executions | /credentials/... | ...",
        "query": { "limit": "5" },     // опционально
        "body":  { ... }                // опционально, для POST/PUT/PATCH
      }
    }
  }
}
```

Ответ приходит в `runData["Shape Response"][0].data.main[0][0].json` как `{ status, headers, body }`, где `body` — это распарсенный JSON от n8n API.

### Готовые рецепты

| Задача | `body` для proxy |
| --- | --- |
| Список workflows | `{"method":"GET","path":"/workflows","query":{"limit":"50"}}` |
| Получить workflow | `{"method":"GET","path":"/workflows/<id>"}` |
| Обновить workflow | `{"method":"PUT","path":"/workflows/<id>","body":{...без id/active/createdAt/updatedAt/versionId/triggerCount/tags/meta/scopes/shared/isArchived/parentFolderId/staticData/pinData}}` |
| Создать workflow | `{"method":"POST","path":"/workflows","body":{name, nodes, connections, settings}}` |
| Удалить workflow | `{"method":"DELETE","path":"/workflows/<id>"}` |
| Активировать | `{"method":"POST","path":"/workflows/<id>/activate"}` |
| Деактивировать | `{"method":"POST","path":"/workflows/<id>/deactivate"}` |
| Список executions | `{"method":"GET","path":"/executions","query":{"workflowId":"<id>","limit":"20"}}` |
| Детали execution | `{"method":"GET","path":"/executions/<id>","query":{"includeData":"true"}}` |
| Список credentials schema | `{"method":"GET","path":"/credentials/schema/<typeName>"}` |
| Список тегов | `{"method":"GET","path":"/tags"}` |
| Список проектов | `{"method":"GET","path":"/projects"}` |
| Список переменных | `{"method":"GET","path":"/variables"}` |

После `PUT /workflows/<id>` n8n не пересоздаёт активные триггеры автоматически — отдельно вызови `POST /workflows/<id>/activate`.

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
