# MarkVision Finance

Личный финансовый ассистент: Telegram-бот (текст/голос) → n8n → Supabase → Lovable-дашборд.

Управляешь финансами голосом — бот понимает доходы, расходы, кредиты, цели, задачи. Автоматические утренние/вечерние сводки, недельные отчёты, напоминания за час до встречи.

## Архитектура

```
Telegram ─► n8n: Personal Assistant ─► Google Calendar
                  │                        │
                  ▼                        ▼
              Supabase ──────────► Lovable dashboard
                  ▲                  (realtime)
                  │
              n8n: Scheduler v2
              (4 cron-триггера)
```

## Содержимое репозитория

```
.
├── README.md                    — этот файл
├── .gitignore                   — gitignore для .env.local и temp
├── .mcp.json                    — конфиг n8n MCP-сервера (для Claude Code)
├── .env.local.example           — шаблон env-переменных
├── sql/                         — SQL миграции для Supabase (порядок применения)
│   ├── 01_init.sql              — базовая схема: tasks, expenses, telegram_users, goals
│   ├── 02_finance.sql           — финансы: incomes, debts, debt_payments, goal_contributions + views
│   └── 03_tasks_extensions.sql  — расширения tasks: is_todo, due_date, reminded_at
├── n8n/                         — JSON workflow для импорта в n8n
│   ├── 01-assistant-bot.json    — первая версия бота (history)
│   ├── 02-daily-digest.json     — первая версия scheduler (history)
│   └── main-bot-v3-with-done-status.json — расширенный main bot с mark_done + status_query
├── lovable/                     — промпты для Lovable.dev
│   ├── PROMPT.md                — задачи + расходы
│   ├── PROMPT-finance.md        — финальный промпт (задачи + расходы + доходы + цели + кредиты)
│   ├── PROMPT-finance-update.md — добавка для синхронизации существующего проекта
│   └── SUPABASE_CREDENTIALS.md  — куда подключать Supabase в Lovable
└── docs/
    └── n8n-mcp-setup.md         — как подключить n8n MCP-сервер в Claude Code
```

## Быстрый старт (на чистой машине)

### 1. Supabase

1. Зарегистрируйся на https://supabase.com
2. Создай новый проект (free tier подойдёт), регион поближе
3. SQL Editor → Run `sql/01_init.sql` → `sql/02_finance.sql` → `sql/03_tasks_extensions.sql` (по порядку)
4. Создай тестового юзера: Authentication → Add user (email/password)
5. Скопируй из Settings → API:
   - **Project URL** (`https://xxx.supabase.co`)
   - **anon / publishable key**
   - **service_role key** (секретно)

### 2. Telegram бот

1. Открой `@BotFather` → `/newbot` → следуй инструкциям
2. Сохрани токен
3. Создай чат/группу для бота, добавь его туда, отключи **Group Privacy** через BotFather (Bot Settings → Group Privacy → Turn off)
4. Узнай chat_id через `@userinfobot` или из логов n8n

### 3. n8n

1. Подними n8n (self-hosted или n8n.cloud)
2. Workflows → Import from File → импортируй из `n8n/`:
   - `01-assistant-bot.json` ИЛИ `main-bot-v3-with-done-status.json` (расширенная)
   - `02-daily-digest.json`
3. В каждом workflow открой ноду **Env / Env + Chat** и вставь свой `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
4. Подключи credentials:
   - **Telegram** (Bot Token)
   - **OpenAI API key**
   - **Google Calendar OAuth** (для событий)
5. В Supabase Editor → таблица `telegram_users` → INSERT свой `user_id` (из auth.users) ↔ свой `telegram_chat_id`
6. Активируй workflow

### 4. Lovable фронт

1. Открой https://lovable.dev
2. New Project → вставь содержимое `lovable/PROMPT-finance.md` как первое сообщение
3. На этапе Connect Supabase используй данные из `lovable/SUPABASE_CREDENTIALS.md` (URL + anon key)
4. Lovable построит UI, ты деплоишь его одной кнопкой

### 5. Claude Code MCP (опционально, если хочешь чтобы Claude мог редактировать n8n из кода)

1. `cp .env.local.example .env.local`
2. Заполни `N8N_API_URL` и `N8N_API_KEY` (n8n Settings → API → Create API Key)
3. См. `docs/n8n-mcp-setup.md` для подробностей

## Возможности бота (что понимает голосом/текстом)

| Команда | Что делает |
|---------|-----------|
| `завтра в 15 встреча с врачом` | Создаёт событие в Calendar + tasks. Через 5 мин до часа отправит напоминание. |
| `подготовить отчёт к пятнице` | Добавляет todo с `due_date=пятница`. Появится в утреннем дайджесте. |
| `отмени встречу с врачом` | AI находит → DELETE из Calendar + UPDATE status=cancelled. |
| `потратил 1500 на обед` | INSERT в expenses + бот отвечает суммой за день. |
| `поступила оплата от Газпром 250000` | INSERT в incomes с client_name='Газпром'. |
| `внёс 30к по ипотеке` | AI находит долг → INSERT debt_payments → триггер БД уменьшает остаток. |
| `положил 100 тысяч на квартиру` | AI находит цель → INSERT goal_contributions → триггер обновляет прогресс. |
| `новый кредит на машину 1.8 миллиона на 5 лет под 15%` | Создаёт debt с расчётом end_date. |
| `цель квартира 5 миллионов к декабрю 2027` | Создаёт goal. |

## Расписания (Scheduler v2)

- **Каждые 5 мин** — проверка ближайших встреч → за час «⏰ Через час: ...»
- **08:00 Astana** — утренний дайджест: задачи на сегодня + todo + расходы вчера
- **20:00 Astana** — план на завтра: события + todo
- **Воскресенье 19:00** — еженедельный отчёт: доходы/расходы/категории/клиенты/прогресс целей

## Что НЕ доделано (roadmap)

- ❌ Закрытие задач голосом («сделал презентацию») — есть в `main-bot-v3-with-done-status.json`, импортируй для активации
- ❌ Перенос задачи на другое время
- ❌ Статус-запросы голосом («сколько потратил сегодня») — есть в v3 JSON
- ❌ Уведомления о платеже за 3 дня до даты (нужна доп. колонка `next_payment_date` в `debts`)
- ❌ OCR чеков по фото
- ❌ Повторяющиеся задачи
- ❌ Алерты по аномалиям расходов
- ❌ Подключение банка (Tinkoff/Сбер webhook)
- ❌ Multi-user (схема готова, нужен UI приглашений)

## Стек

- **Backend orchestration**: n8n (self-hosted)
- **Database + Auth**: Supabase (PostgreSQL)
- **AI**: OpenAI GPT-4o-mini (Classify/Parse) + Whisper (voice transcription)
- **Calendar**: Google Calendar API
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui + Recharts (Lovable.dev)
- **Bot**: Telegram Bot API
