# Personal Assistant — Telegram + n8n + Supabase + Lovable

Личный ассистент: ставишь задачи и фиксируешь расходы голосом или текстом в Telegram, всё попадает в Google Calendar / Supabase, фронт на Lovable показывает дашборд.

## Архитектура

```
Telegram (текст или голос)
     │
     ▼
n8n  ─── Whisper (для голоса) ─── OpenAI (классификация + парсинг)
     │
     ├─► Google Calendar (для задач) ───► Supabase tasks (зеркало)
     │
     └─► Supabase expenses (для расходов)
                                   │
                                   ▼
                          Lovable frontend (дашборд)
```

## Что уже сделано автоматически

- ✅ Supabase-проект `personal-assistant` создан (id: `zcsxzgigtsdoebtginfy`, region: `eu-central-1`)
- ✅ Схема БД накатана: `telegram_users`, `tasks`, `expenses`, `expense_categories`, `goals`
- ✅ RLS политики (каждый видит только своё)
- ✅ Триггер автосоздания 7 дефолтных категорий расходов при регистрации
- ✅ RPC `get_user_by_chat_id` для лукапа пользователя из n8n
- ✅ Готовы 2 n8n workflow в JSON для импорта
- ✅ Готов промпт для Lovable

## Что делать тебе (по шагам)

### 1. Импорт n8n workflow

Открой n8n → Workflows → New → ⋮ → **Import from File**:

- `personal-assistant/n8n/01-assistant-bot.json` — основной бот (Telegram → задачи/расходы)
- `personal-assistant/n8n/02-daily-digest.json` — утренние/вечерние уведомления

При импорте n8n спросит подключить credentials:

| Что | Где взять |
|-----|-----------|
| **Telegram (Bot Token)** | Создай бота через `@BotFather` → `/newbot` → токен → в n8n: Credentials → New → Telegram |
| **OpenAI API** | https://platform.openai.com/api-keys |
| **Google Calendar OAuth2** | Google Cloud Console → OAuth client → редирект n8n callback |

В каждом workflow есть нода **`Env + Chat`** (или `Env`) — открой её и в поле `SUPABASE_SERVICE_ROLE_KEY` вставь значение из Supabase Dashboard → Settings → API → `service_role` key.

После — нажми **Activate** в обоих workflow.

### 2. Lovable фронт

Прочитай `personal-assistant/lovable/PROMPT.md` — там готовый промпт. Скопируй в lovable.dev, новый проект, на этапе Supabase используй `SUPABASE_CREDENTIALS.md`.

### 3. Привязать свой Telegram

1. Включи в Supabase → Authentication → Providers → Email
2. Зарегистрируйся в Lovable-приложении (вылетит email/пароль)
3. Узнай свой `chat_id`: напиши боту `/start` → лог в n8n покажет твой chat_id. Или используй бот `@userinfobot`
4. В фронте на странице Settings вставь свой `chat_id` — создастся строка в `telegram_users`
5. Теперь бот тебя «знает» и принимает сообщения

### 4. Тест

В Telegram пиши боту:

> Завтра в 10 утра встреча с врачом на час

— должна появиться задача в Google Calendar + строка в `tasks`. Бот ответит «✅ Записал задачу...».

> Потратил 1500 на обед в кафе

— должна появиться строка в `expenses` с категорией «Еда». Бот ответит суммой за сегодня.

Голосовое сообщение работает так же — Whisper расшифровывает.

## Файлы

```
personal-assistant/
├── README.md                                 ← этот файл
├── n8n/
│   ├── 01-assistant-bot.json                 ← главный бот
│   └── 02-daily-digest.json                  ← 08:00 + 21:00 уведомления
├── sql/
│   └── init_assistant_schema.sql             ← копия миграции (уже применена)
└── lovable/
    ├── PROMPT.md                             ← промпт для Lovable
    └── SUPABASE_CREDENTIALS.md               ← URL + anon key
```

## Расширить дальше

- **Цели** — в фронте уже есть страница «Цели», логика начисления вручную через UI. Можно добавить триггер в БД: при INSERT в expenses обновлять `current_amount` целей с этим `category_id`.
- **Категории динамически** — добавь в Settings UI создание/редактирование, дефолты уже посеяны.
- **Доход/баланс** — добавь таблицу `incomes` + `accounts` если нужен полноценный бюджет.
- **Аналитика** — Lovable умеет рисовать дашборды; промпт описывает только базу.
