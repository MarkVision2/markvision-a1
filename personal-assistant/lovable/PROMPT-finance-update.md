# Добавка к существующему Lovable проекту

Если фронт уже сделан по основному `PROMPT-finance.md`, вставь это сообщение чтобы освежить и проверить что всё на месте:

---

В Supabase теперь все данные собираются через Telegram-бота. Убедись что фронт показывает все эти источники:

## Главная (`/`)

- **Cashflow за 12 мес** — VIEW `monthly_balance` (`income_total`, `expense_total`, `balance` по месяцам). Recharts ComposedChart.
- **KPI этого месяца**: доходы / расходы / баланс. Цвет: + зелёный, − красный.
- **Активные цели**: карточки с прогресс-баром (`current_amount / target_amount × 100%`). Источник `goals` где `is_archived=false`.
- **Кредиты** — VIEW `debts_summary` (active_count, total_remaining, total_monthly).
- **Последние транзакции (10)**: объединённая лента `expenses` + `incomes` отсортированная по дате. Расходы красная стрелка, доходы зелёная.

## Расходы (`/expenses`)

- Фильтр по периоду (Сегодня / Неделя / Месяц / Год / Кастом).
- BarChart по дням, PieChart по категориям.
- Прогресс по `expense_categories.monthly_limit` — горизонтальный бар.
- Таблица транзакций с inline-редактированием + удалением.

## Доходы (`/incomes`)

- Аналогично расходам, акцент зелёный.
- **Раздел «По клиентам»** — группировка `incomes` по `client_name` (где не null), сортировка по сумме.

## Цели (`/goals`)

- Сетка карточек с прогресс-баром.
- При клике на карточку → модалка с историей `goal_contributions` (графика accumulation).
- Кнопка «+ Внести» открывает форму → INSERT в `goal_contributions` (триггер БД сам обновит `current_amount`).

## Кредиты (`/debts`)

- Список с остатками.
- Прогресс выплат: `1 - (current_balance / initial_amount)`.
- История платежей: лента `debt_payments` для каждого кредита.
- Кнопка «+ Внести платёж» → INSERT в `debt_payments` (триггер уменьшит баланс автоматически).

## Задачи (`/tasks`)

- Календарь / список с переключателем.
- **Todo-список** (где `is_todo=true`) — отдельная вкладка или фильтр.
- Чекбокс «выполнено» → UPDATE `status='done'`.

## Realtime

Подписки на `tasks`, `expenses`, `incomes`, `debt_payments`, `goal_contributions` через `supabase.channel(...)` — когда бот пишет данные, фронт обновляется без F5.

## Данные подключения

- URL: `https://lsgwjiwzaillykuqegxb.supabase.co`
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzZ3dqaXd6YWlsbHlrdXFlZ3hiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODgwMzgsImV4cCI6MjA5NTQ2NDAzOH0.4PgqAWL4einCmbsg_euN672Ca1FrwcJ-prm8qai1MGo`

## Проверка после деплоя

Отправь боту в Telegram эти команды и убедись что они появились на фронте без перезагрузки:

1. `потратил 1500 на обед` → видим новую строку в Расходах
2. `поступила оплата от Газпром 50000` → видим в Доходах, в группировке «По клиентам» появился Газпром
3. `новая цель Машина 2 миллиона к декабрю 2026` → новая карточка в Целях
4. `положил 100 тысяч на машину` → прогресс по цели Машина обновился
