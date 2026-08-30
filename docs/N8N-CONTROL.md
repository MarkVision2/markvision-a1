# n8n: прямое управление воркфлоу из Claude

Раньше воркфлоу описывались markdown-доками (`docs/n8n-*.md`), которые переносились
в интерфейс n8n руками. Этот контур даёт Claude прямой доступ к n8n Public API:
читать, править, создавать и активировать воркфлоу, разбирать упавшие запуски.

**Инстанс:** `https://n8n.zapoinov.com` · **CLI:** `scripts/n8n.mjs`

## Настройка

1. Ключ: n8n → Settings → **n8n API** → Create an API key.
2. В `.env` (в git не попадает):
   ```
   N8N_BASE_URL=https://n8n.zapoinov.com
   N8N_API_KEY=<ключ>
   ```
3. Проверка: `node scripts/n8n.mjs ping` → `OK … — воркфлоу: N (активных M)`.

### Сеть

Локальная сессия Claude Code ходит на n8n напрямую. **Облачная** (Claude Code на вебе)
идёт через egress-прокси с allowlist — по умолчанию хост закрыт, `ping` вернёт
«Хост … закрыт политикой сети окружения». Лечится добавлением `n8n.zapoinov.com`
в network egress настроек окружения.

## Команды

```bash
node scripts/n8n.mjs ping                              # связь + ключ
node scripts/n8n.mjs list [--active] [--name Clony]    # список воркфлоу
node scripts/n8n.mjs get <id> [--out wf.json]          # полный JSON
node scripts/n8n.mjs pull [--dir n8n/workflows]        # выгрузить все в файлы
node scripts/n8n.mjs push <файл.json> [--id <id>] [--activate]
node scripts/n8n.mjs activate <id> | deactivate <id>
node scripts/n8n.mjs executions [--workflow <id>] [--status error] [--limit 20]
node scripts/n8n.mjs execution <id> [--data]           # разбор одного запуска
```

## Версионирование воркфлоу

`pull` кладёт каждый воркфлоу в `n8n/workflows/<слаг>.<id>.json`. Смысл:

- diff воркфлоу виден в git — что именно изменилось между правками;
- Claude читает и правит воркфлоу офлайн, без обращения к API;
- откат: `git checkout <файл>` → `push`.

Рабочий цикл: `pull` → правка JSON → `push <файл>` → `executions --status error` на проверку.
Перед правкой всегда `pull` — в n8n могли поменять руками, и `push` затрёт эти изменения.

## Ограничения Public API

- **Запуска воркфлоу нет.** Прод-запуск — только через его webhook
  (у Контент-завода это `POST /webhook/clony-yurii`, см. `n8n-content-factory-webhook-contract.md`).
- `PUT /workflows/:id` принимает только `name`, `nodes`, `connections`, `settings`
  (+ `staticData`). Лишние поля (`id`, `active`, `tags`, `createdAt`, `versionId`) → 400.
  `push` их срезает сам.
- **Активность через `push` не переносится** — на новый воркфлоу нужен `--activate`.
- Значения credentials не читаются и не отдаются API — в JSON только их id и имя.
  Заводить и менять креды — руками в интерфейсе.
- Ответы постраничные (курсор); CLI собирает страницы сам.

## Связанные доки

- `n8n-content-factory-webhook-contract.md` — контракт фронт → n8n (Контент-завод)
- `n8n-content-factory-copy-mode.md`, `-creative-formats.md`, `-neuro-face.md` — режимы генерации
- `n8n-ai-lab-crm-stages.md` — обратный путь n8n → CRM (`crm-stage-update`, `x-automation-key`)
