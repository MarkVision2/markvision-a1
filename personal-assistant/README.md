# Personal Assistant — полное руководство

Личный ассистент: Telegram-бот (голос+текст) → n8n → Google Calendar + Supabase → Lovable-фронт. Финансы (расходы/доходы/кредиты/цели), задачи, todo-список, напоминания, ежедневные/еженедельные отчёты.

---

## Архитектура

```
Telegram (текст/voice)
        │
        ▼
n8n: Personal Assistant ────────── Google Calendar (события)
   classify → route → handle      │
        │                          ▼
        ▼                       Supabase
  Reply: подтверждение           ├── tasks
                                 ├── expenses, expense_categories
                                 ├── incomes, income_categories
                                 ├── debts, debt_payments
                                 ├── goals, goal_contributions
                                 ├── telegram_users
                                 └── monthly_balance, debts_summary (views)
                                          │
                                          ▼
                              n8n: Scheduler v2 ── ежедневные/раз в час триггеры
                                          │
                                          ▼
                              Telegram ← дайджесты + напоминания
                              
                              Lovable dashboard ← читает Supabase в реалтайме
```

### Активные n8n workflow

| Workflow | ID | Триггеры | Что делает |
|----------|-----|----------|------------|
| `Personal Assistant` | `NJqcFNk0BCk0M3aE` | Telegram message | Принимает все команды от пользователя |
| `Personal Assistant — Scheduler v2` | `xY2vKMScdSm8r0Su` | cron `*/5 * * * *`, `0 8 * * *`, `0 20 * * *`, `0 19 * * 0` | Напоминания + утро + вечер + воскресенье 19:00 итоги недели |
| `Claude n8n API Proxy` | `uj5DcNatRXYqNkoO` | Webhook | Внутренний прокси для управления через MCP |
| `Supabase Proxy` | `LYfJ5iscq6zsSNY3` | Webhook | Внутренний прокси для диагностики БД |

Timezone везде: `Asia/Almaty` (UTC+05:00).

---

## Что бот понимает в Telegram

Пишешь текстом или голосом — бот классифицирует через `Classify Intent` (GPT-4o-mini) и направляет в нужную ветку.

### 📅 Задачи и встречи

| Что пишешь | Что происходит |
|-----------|----------------|
| `завтра в 15 встреча с врачом` | Создаётся событие в Google Calendar + запись в `tasks` + popup-напоминание за час в календаре |
| `через час созвон с командой` | То же, время = сейчас + 1 час, длительность 30 мин |
| `в пятницу 19:30 ужин в Магадане` | Ближайшая пятница, длительность 60 мин |
| `29 числа в 12 приём у стоматолога` | Конкретная дата текущего месяца, длительность 60 мин |

После создания: за **1 час до** наступления приходит «⏰ Через час: ...» от Scheduler v2.

### 📌 Todo (задачи без точного времени)

| Что пишешь | Что происходит |
|-----------|----------------|
| `не забыть купить молоко` | INSERT в `tasks` с `is_todo=true`, `due_date=сегодня`. В Calendar НЕ идёт |
| `подготовить презентацию к завтрашней встрече` | `due_date=завтра`, попадёт в утренний/вечерний дайджест |
| `составить отчёт до пятницы` | `due_date=пятница` |

### 🗑 Отмена задач

| Что пишешь | Что происходит |
|-----------|----------------|
| `отмени встречу с врачом` | AI находит подходящую задачу → DELETE из Calendar + UPDATE `status='cancelled'` |
| `удали задачу на завтра` | То же |
| `убери встречу 15:00` | По времени матчит |

### 💸 Расходы

| Что пишешь | Что происходит |
|-----------|----------------|
| `потратил 1500 на обед` | INSERT в `expenses`, категория `food`, валюта RUB, бот отвечает суммой за сегодня |
| `купил кофе за 5 долларов` | Категория `food`, currency `USD` |
| `такси 600` | Категория `transport`, valuta RUB |

Категории расходов сами сидируются при регистрации: `food`, `transport`, `entertainment`, `household`, `clothing`, `health`, `other`.

### 💰 Доходы (NEW)

| Что пишешь | Что происходит |
|-----------|----------------|
| `поступила оплата от Иван 50000` | INSERT в `incomes`, `client_name='Иван'`, category `client` |
| `получил зарплату 200к` | category `salary` |
| `подарили 5000` | category `gift` |
| `вернули 2000` | category `refund` |

Категории доходов сидируются: `client`, `salary`, `gift`, `refund`, `other`.

### 🏦 Кредиты (NEW)

#### Создать новый кредит:
| Что пишешь | Что происходит |
|-----------|----------------|
| `новый кредит на машину 1.8 млн на 5 лет под 15%` | INSERT в `debts` с `kind=loan`, `monthly_payment` авто-рассчитан, `end_date=сейчас+5 лет` |
| `оформил ипотеку 8 млн` | `kind=loan`, `name=Ипотека` |
| `взял рассрочку на телефон 60000` | `kind=installment` |

#### Внести платёж:
| Что пишешь | Что происходит |
|-----------|----------------|
| `внёс по ипотеке 30к` | AI находит долг с `name~ипотека` → INSERT в `debt_payments` → триггер БД уменьшает `current_balance` |
| `заплатил 15000 по кредиту на машину` | Аналогично |
| `погасил кредит 50000` | Если задолженность ≤ 50к — `is_closed=true` автоматически |

### 🎯 Цели (NEW)

#### Создать цель:
| Что пишешь | Что происходит |
|-----------|----------------|
| `цель квартира 5 миллионов к декабрю 2027` | INSERT в `goals`, `kind=asset_purchase`, `target_date=2027-12-01` |
| `хочу накопить миллион` | `kind=savings` |
| `новая цель машина 2 млн` | `kind=asset_purchase` |

#### Пополнить цель:
| Что пишешь | Что происходит |
|-----------|----------------|
| `положил 100 тысяч на квартиру` | AI находит цель → INSERT в `goal_contributions` → триггер обновляет `current_amount` |
| `отложил 50000 на машину` | Аналогично |
| `накопил 10к на отпуск` | Аналогично |

---

## ⏰ Автоматические уведомления (Scheduler v2)

### Каждые 5 минут — проверка ближайших встреч
Скрипт ищет задачи где `starts_at` через 55–65 минут и `reminded_at IS NULL`. Если находит — отправляет «⏰ Через час: <название>» и ставит `reminded_at=NOW()` чтобы не задвоить.

### 08:00 Astana — утренний дайджест
```
☀️ Юрий, доброе утро.
Сегодня — 28 мая, четверг.

📅 События и встречи (3 задачи):

09:00 — Утренняя пробежка
   ⏱ 60 мин

11:30 — Созвон с командой
   ⏱ 30 мин · _ежнедельный синк_

15:00 — Встреча с врачом
   ⏱ 60 мин

📌 Нужно сделать (2):

• Подготовить презентацию
• Купить молоко

💸 Вчера потрачено: 2450 ₽
   • Еда: 850 ₽
   • Транспорт: 600 ₽
   • Развлечения: 1000 ₽

Хорошего дня 🚀
```

### Воскресенье 19:00 — еженедельный отчёт
```
📊 Юрий, итоги недели
21 мая — 28 мая

💰 Доходы: 250000 ₽
💸 Расходы: 87500 ₽
📈 Баланс: +162500 ₽

По категориям расходов:
   • Еда: 32000 ₽
   • Транспорт: 18000 ₽
   • Развлечения: 22000 ₽
   • Прочее: 15500 ₽

Топ клиентов:
   • Газпром: 200000 ₽
   • Иван Иванов: 50000 ₽

🎯 Прогресс по целям:
   • Квартира: 12% (600000 / 5000000 RUB)
   • Машина: 35% (700000 / 2000000 RUB)

Хорошей новой недели 🚀
```

### 20:00 Astana — план на завтра
```
🌙 Юрий, добрый вечер.
Отправляю план на завтра — 29 мая, пятница.

📅 События и встречи (...):
[список с временем, длительностью, описанием]

📌 Нужно сделать (...):
[список todo с дедлайном завтра]

Спокойной ночи 🌙
```

---

## 🖥 Lovable фронтенд

Отдельный проект в Lovable, подключён к Supabase. Отображает все данные в красивом UI с realtime-обновлением.

Страницы (по ТЗ в `personal-assistant/lovable/PROMPT-finance.md`):
- 🏠 Главная — cashflow за 12 мес, KPI, последние транзакции, активные цели
- 💸 Расходы — графики, категории, лимиты, история
- 💰 Доходы — по клиентам, динамика
- 🎯 Цели — карточки с прогрессом, история пополнений
- 🏦 Кредиты — список с остатками, история платежей
- 📅 Задачи — календарь/список, чекбоксы выполнения
- ⚙️ Настройки — Telegram chat_id, категории, лимиты

---

## 📊 Supabase

### Подключение

| Что | Где |
|-----|-----|
| Dashboard | https://supabase.com/dashboard/project/lsgwjiwzaillykuqegxb |
| API URL | `https://lsgwjiwzaillykuqegxb.supabase.co` |
| Region | eu-central-1 |
| Anon key (для фронта) | `eyJhbGc...4PgqAW...` (в `personal-assistant/lovable/SUPABASE_CREDENTIALS.md`) |
| Service role (для n8n) | в `.env.local`, никогда не светить публично |

### Таблицы (12 шт)

```
auth.users           — пользователи (Supabase Auth)
telegram_users       — связь chat_id ↔ user_id
tasks                — события и todo
expense_categories   — категории расходов
expenses             — расходы
income_categories    — категории доходов
incomes              — доходы (с client_name)
debts                — кредиты
debt_payments        — платежи по кредитам (триггер обновляет current_balance)
goals                — цели
goal_contributions   — пополнения целей (триггер обновляет current_amount)

VIEW monthly_balance — доходы/расходы по месяцам
VIEW debts_summary   — сводка активных кредитов
```

### Колонки `tasks`
```
id UUID PK
user_id UUID FK → auth.users
title TEXT NOT NULL
description TEXT
starts_at TIMESTAMPTZ (nullable; null для todo)
ends_at TIMESTAMPTZ
duration_minutes INT
google_event_id TEXT (если событие в Calendar)
status TEXT ('pending'|'done'|'cancelled')
raw_text TEXT (что пользователь продиктовал)
source TEXT ('telegram'|'manual')
due_date DATE (для is_todo=true)
reminded_at TIMESTAMPTZ (когда отправлено напоминание за час)
is_todo BOOLEAN (true = задача без точного времени)
created_at, updated_at
```

### Колонки `debts`
```
id, user_id
name TEXT (Ипотека, Кредит на машину)
kind ('loan'|'credit_card'|'installment'|'personal'|'other')
initial_amount NUMERIC (изначальная сумма)
current_balance NUMERIC (сколько осталось — триггер обновляет)
currency TEXT
interest_rate NUMERIC (% годовых)
monthly_payment NUMERIC (обязательный месячный платёж)
start_date, end_date DATE
is_closed BOOLEAN (триггер ставит true когда balance=0)
closed_at TIMESTAMPTZ
description, created_at, updated_at
```

### Колонки `incomes`
```
id, user_id
amount NUMERIC, currency TEXT
category_id → income_categories
client_name TEXT (кто заплатил — для фриланса)
description, raw_text, source
received_at, created_at
```

### Колонки `goals`
```
id, user_id
name TEXT
kind ('savings'|'spending_limit'|'asset_purchase'|'debt_payoff')
target_amount, current_amount NUMERIC (триггер обновляет)
currency TEXT
category_id → expense_categories (для spending_limit)
target_date DATE
icon, color, description
is_archived BOOLEAN
created_at, updated_at
```

---

## 🔑 Безопасность

- **service_role** ключ — только в n8n и в `.env.local`. Никогда не отдавать на фронт или в публичный код.
- **anon / publishable** — безопасен в фронте, RLS защитит данные.
- **RLS** включён на всех таблицах: `auth.uid() = user_id`. n8n обходит RLS через service_role.
- **Telegram bot token** — хранится только в n8n credentials.
- **Whitelist в `telegram_users`** — бот принимает сообщения только от привязанных chat_id. Остальным отвечает «Доступ запрещён».

---

## 🧪 Как тестировать

### 1. Тест задачи с напоминанием
1. Напиши в группу: `через 65 минут встреча с командой`
2. Сразу: «✅ Записал событие...»
3. Через ~5 минут (когда задача попадёт в окно 55–65 мин): «⏰ Через час: Встреча с командой»
4. В Google Calendar — событие на нужное время

### 2. Тест todo
1. `подготовить отчёт к завтра`
2. «📌 Добавил в список»
3. Утром в 08:00 — попадёт в утренний дайджест в блок «📌 Нужно сделать»

### 3. Тест расхода
1. `потратил 800 на обед`
2. «💸 Записал расход: 800 RUB — Еда. Сегодня всего: 800 RUB»

### 4. Тест дохода (NEW)
1. `получил оплату от Газпрома 250000`
2. «💰 Доход записан: +250000 RUB. 📂 Клиент. 👤 Газпром»

### 5. Тест нового кредита (NEW)
1. `новый кредит на машину 1.8 миллиона на 5 лет под 15%`
2. «🏦 Создал кредит: Кредит на машину. 💵 1800000 RUB. 📅 ~42700/мес»

### 6. Тест платежа по кредиту (NEW)
Сначала должен быть активный кредит.
1. `внёс 30 тысяч по кредиту на машину`
2. «🏦 Платёж по кредиту: Кредит на машину. Внёс: −30000 RUB. Остаток: ~1770000 RUB»

### 7. Тест новой цели (NEW)
1. `цель квартира 5 миллионов к декабрю 2027`
2. «🎯 Создал цель: Квартира. Цель: 5000000 RUB. 📅 до 2027-12-01»

### 8. Тест пополнения цели (NEW)
1. `положил 100 тысяч на квартиру`
2. «🎯 Пополнил цель: Квартира. +100000 RUB. Прогресс: ~100000 / 5000000 RUB»

### 9. Тест отмены
1. `отмени встречу с командой`
2. «🗑 Отменил задачу: Встреча с командой»

---

## 🛠 Поддерживаемая инфраструктура

### Файлы в репо `markvision-a1/personal-assistant/`

```
README.md                        — этот файл (главная инструкция)
n8n/
  01-assistant-bot.json          — оригинальный JSON для импорта (history)
  02-daily-digest.json           — оригинальный scheduler JSON
sql/
  init_assistant_schema.sql      — базовая схема (tasks, expenses, etc.)
  02_finance_schema.sql          — финансовая схема (incomes, debts, etc.)
  03_tasks_extensions.sql        — добавление is_todo, due_date, reminded_at
lovable/
  PROMPT.md                      — первая версия промпта (задачи+расходы)
  PROMPT-finance.md              — финальный промпт с финансами
  SUPABASE_CREDENTIALS.md        — куда подключать Lovable
```

### Файлы за пределами репо (не коммитим)

```
.env.local                       — N8N_API_KEY, SUPABASE_ACCESS_TOKEN, service_role
                                   (gitignored через *.local)
```

---

## ⏳ Что ещё в планах

### 🟡 Высокий приоритет — улучшения UX
- ✅ **Еженедельный отчёт** — воскресенье 19:00, сводка за неделю (доходы/расходы/категории/клиенты/цели)
- ❌ **Закрытие задач голосом** — «сделал презентацию» → AI находит todo → `status='done'`
- ❌ **Перенос задачи** — «перенеси встречу с врачом на пятницу 11:00» → UPDATE + GCal patch
- ❌ **Статус-запросы** — «сколько я потратил сегодня», «что осталось по ипотеке», «прогресс по квартире» → бот отвечает цифрой
- ❌ **Уведомления о платеже** — за 3 дня до `debts.monthly_payment` → «не забудь внести по ипотеке N руб» (нужно `next_payment_date` колонка)

### 🟢 Cool-фичи (low priority)
- **OCR чеков** — фото чека → Vision модель → расход
- **Повторяющиеся задачи** — «каждый понедельник в 10 планёрка»
- **Алерты по аномалиям** — «ты сегодня уже потратил 5000 на еду, обычно 1500»
- **Подключение банка** — Tinkoff/Сбер webhook → автоматический expense
- **Multi-user** — пригласить партнёра, общий бюджет (RLS уже готов)

### Архитектурный долг
- Main bot вырос до 63 нод. Дальнейшие фичи лучше делать через **n8n AI Agent** с tools — будет на порядок компактнее. Это рефактор на ~1 день.

---

## 📞 Контакты сущностей

| Что | Где |
|-----|-----|
| n8n инстанс | https://n8n.zapoinov.com |
| Supabase Dashboard | https://supabase.com/dashboard/project/lsgwjiwzaillykuqegxb |
| Telegram bot | `@<bot username>` (пишет в группу chat_id `-5262660394`) |
| Lovable app | (URL после деплоя из Lovable) |
| GitHub repo | `markvision2/markvision-a1` ветка `claude/telegram-n8n-task-assistant-cDlMh` |
