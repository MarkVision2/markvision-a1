# n8n MCP integration (always-on)

Подключаем `n8n-mcp` как проектный MCP-сервер — Claude получает прямой доступ к n8n API: создание/редактирование/удаление workflow, валидация, управление credentials.

## Файлы

- `.mcp.json` — конфиг MCP-сервера (закоммичен)
- `.env.local` — секреты (gitignored через `*.local`)
- `.env.local.example` — шаблон с переменными

## Что нужно сделать

### Локально (Claude Code CLI)

```bash
cp .env.local.example .env.local
# открой .env.local, вставь свой n8n API key
# (n8n → Settings → API → Create API Key)

# перезапусти claude в корне проекта — увидишь mcp-сервер `n8n` в списке
```

### Claude Code on the web

Env-переменные в sandbox не персистят между запусками, поэтому пропиши их в настройках Environment:

1. https://claude.ai/code → Environments → твой env (markvision-a1)
2. Add Environment Variable:
   - `N8N_API_URL` = `https://n8n.zapoinov.com/api/v1`
   - `N8N_API_KEY` = (твой ключ)
3. Сохранить → новые сессии будут видеть MCP-сервер n8n.

Альтернативно — каждый раз вручную писать `.env.local` в начале сессии, но через web env config проще.

## Доступные инструменты после перезапуска

| Категория | Инструменты |
|-----------|-------------|
| Workflows | `n8n_list_workflows`, `n8n_get_workflow`, `n8n_create_workflow`, `n8n_update_full_workflow`, `n8n_update_partial_workflow`, `n8n_delete_workflow` |
| Validation | `n8n_validate_workflow`, `n8n_autofix_workflow`, `n8n_test_workflow` |
| Execution | `n8n_executions`, `n8n_workflow_versions` |
| Discovery | `search_nodes`, `get_node`, `validate_node`, `tools_documentation` |
| Templates | `search_templates`, `get_template`, `n8n_deploy_template`, `n8n_generate_workflow` |
| Admin | `n8n_manage_credentials`, `n8n_manage_datatable`, `n8n_audit_instance`, `n8n_health_check` |

Полная замена связке `Claude n8n API Proxy` + `execute_workflow` (раньше через неё ручкой делали).

## Безопасность

- API key даёт **полный доступ** к твоему n8n (создать/удалить любой workflow, читать executions, управлять credentials)
- Никогда не коммить `.env.local`
- Если ключ утёк — n8n → Settings → API → revoke + создать новый
