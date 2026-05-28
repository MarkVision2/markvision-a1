# Чек-лист состояния проекта (по состоянию на 28.05.2026)

## ✅ Работает прямо сейчас

### Бот понимает интенты
- ✅ `task` — создаёт событие в Calendar + Supabase + ставит на ремайндер
- ✅ `cancel` — удаляет событие из Calendar + UPDATE status=cancelled
- ✅ `expense` — INSERT в expenses с правильной категорией (24 правила маппинга)
- ✅ `income` — INSERT в incomes с client_name + категорией (8 правил)
- ✅ `todo` — INSERT в tasks с is_todo=true
- ✅ `debt_payment` — INSERT в debt_payments → триггер уменьшает остаток
- ✅ `goal_contribution` — INSERT в goal_contributions → прогресс цели
- ✅ `new_debt` — INSERT в debts с расчётом end_date
- ✅ `new_goal` — INSERT в goals

### Шедулер (4 крон-триггера)
- ✅ Every 5 min — поиск задач за час, отправка ремайндера, проставление reminded_at
- ✅ 08:00 Astana — утренний дайджест (события сегодня + todo + расходы вчера)
- ✅ 20:00 Astana — план на завтра (события + todo)
- ✅ Воскресенье 19:00 — недельный отчёт (доходы/расходы/категории/прогресс целей)

### Supabase
- ✅ Категории: 16 expense + 10 income, без дублей
- ✅ Все таблицы под user_id `d9044eb2` (правильный, маппится на чат -5262660394)
- ✅ Фантомный user 51d6c21f полностью очищен
- ✅ RLS политика: каждый юзер видит только своё (`auth.uid() = user_id`)
- ✅ Триггеры: автоматическое уменьшение долга при платеже, автоматический прогресс цели при пополнении
- ✅ Views: `monthly_balance`, `debts_summary`

## ⚠️ Дальнейшие шаги (требуют твоего действия)

### 1. Применить миграцию для ремайндеров платежей
Запусти в Supabase SQL Editor: `sql/04_payment_reminders.sql`. Это добавит:
- Колонку `debts.next_payment_date`
- Триггер автоматического переноса даты при платеже
- Заполнит существующие долги начальной датой

### 2. Импортировать yellow tier в n8n
Открой `Personal Assistant` в n8n UI и добавь по инструкции `docs/yellow-tier-deploy.md`:
- Закрытие задач голосом (close_task)
- Перенос задач голосом (reschedule_task)
- Статус-запросы голосом (status_query)
- Cron для ремайндеров платежей за 3 дня

### 3. Проверить Lovable
Зайди на свой проект lovable.dev и убедись что показывает:
- Расходы (с категориями и цветами)
- Доходы
- Цели (карточки с прогресс-баром)
- Кредиты (с остатками)
- Задачи (календарь + список)

Если что-то не показывается — скинь скриншот, я подскажу как поправить промпт для Lovable.

### 4. Перенос в `markvision-ai/markvision-finance`
Следуй `MIGRATION.md` — 3 команды локально:
```bash
git clone --branch claude/telegram-n8n-task-assistant-cDlMh \
  https://github.com/markvision2/markvision-a1.git /tmp/mv-a1
mkdir ~/markvision-finance && cd ~/markvision-finance
git init -b main
cp -r /tmp/mv-a1/markvision-finance-export/. .
git add . && git commit -m "Initial: Personal finance assistant"
git remote add origin https://github.com/markvision-ai/markvision-finance.git
git push -u origin main
```
(сначала создай пустой репо на github.com)

## 🔵 Опционально

### OCR чеков
Принимать фото чеков из телеги, прогонять через OCR (GPT-4o vision) → парсить позиции → INSERT expenses.

### Повторяющиеся задачи
«каждый вторник в 10 спорт» → создавать события на 6 месяцев вперёд.

### Multi-user
Добавить UI приглашений в Lovable. Схема уже готова (`telegram_users` + RLS).

### Бэкап Supabase в S3
Daily pg_dump через cron на отдельный bucket.

## 🐛 Известные нюансы

### Задачи source=google_calendar
В БД есть задачи с `source: google_calendar` (Диана/Айсулу/Глазная/Зауре). Они там осели от прошлой синхронизации с твоим Google Calendar. В текущих 27 n8n-workflow явного GCal sync-а нет — то есть новые они создавать не должны. Но если вдруг увидишь дубли — скажи, найду источник.

### Старый юзер d9044eb2 vs новый 51d6c21f
Долгое время я думал что текущий юзер = 51d6c21f. Это была ошибка с моей стороны. Реальный юзер = `d9044eb2-5824-41b5-971a-f6ede381455e`, маппится на чат `-5262660394` через таблицу `telegram_users`. Сейчас всё чисто, мусора 51d6c21f нет.

### `availableInMCP` settings ключ
n8n public API через PUT /workflows/{id} не принимает `availableInMCP` в settings (хотя POST принимает). Поэтому при обновлении workflow приходится явно его пересоздавать или фильтровать settings.
