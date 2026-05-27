# Как залить эту папку в `markvision-ai/markvision-finance`

Я (Claude) не могу пушить в твой репозиторий — моё окружение разрешает только `markvision2/markvision-a1`. Поэтому делаешь сам, **3 команды** локально:

## Вариант A — через `git clone` исходного репо

```bash
# 1. Клонируй markvision-a1 в темп
git clone --branch claude/telegram-n8n-task-assistant-cDlMh \
  https://github.com/markvision2/markvision-a1.git /tmp/mv-a1

# 2. Создай новый локальный репо для markvision-finance
mkdir ~/markvision-finance && cd ~/markvision-finance
git init -b main

# 3. Скопируй содержимое экспорта (без markvision-finance-export/ wrapper)
cp -r /tmp/mv-a1/markvision-finance-export/. .

# 4. Закоммить и пуш
git add .
git commit -m "Initial: Personal finance assistant — Telegram + n8n + Supabase + Lovable"
git remote add origin https://github.com/markvision-ai/markvision-finance.git
git push -u origin main
```

## Вариант B — через GitHub UI

1. Открой ветку в Github UI: https://github.com/markvision2/markvision-a1/tree/claude/telegram-n8n-task-assistant-cDlMh/markvision-finance-export
2. Скачай как ZIP (Code → Download ZIP), распакуй
3. Зайди в распакованную папку `markvision-finance-export/`
4. `git init -b main && git add . && git commit -m "Initial" && git remote add origin https://github.com/markvision-ai/markvision-finance.git && git push -u origin main`

## После пуша

В новом репо нужно:
1. Settings → Secrets and variables → добавить (если планируешь CI/CD):
   - `N8N_API_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. Создать локально файл `.env.local` (gitignored) по образцу `.env.local.example`
3. Если хочешь чтобы Claude Code мог работать с n8n из этого нового репо — запусти `claude` в его корне, MCP подхватится из `.mcp.json`

## Что НЕ переехало (потому что не в репо живёт)

- **Supabase проект `lsgwjiwzaillykuqegxb`** — облако, привязан к твоему Supabase-аккаунту
- **n8n workflow** — крутятся на `n8n.zapoinov.com`
- **Lovable деплой** — у Lovable свой репо для фронта

Эти три облачных сервиса работают независимо от того где живёт документация.

## Проверка после миграции

```bash
cd ~/markvision-finance
git log --oneline
# должен быть твой initial commit

ls -la
# должны быть README.md, .gitignore, .mcp.json, .env.local.example,
# sql/, n8n/, lovable/, docs/

cat sql/01_init.sql | head -10
# базовая SQL миграция
```

Если что-то не так — пришли ошибку, разберёмся.
