# Промпт для Lovable

Скопируй текст ниже в новый проект на [lovable.dev](https://lovable.dev). Lovable сам подключит Supabase — на шаге подключения вставь данные из соседнего файла `SUPABASE_CREDENTIALS.md`.

---

Я делаю личного ассистента «Personal Assistant». Бэкенд — Supabase (уже готов, схема ниже). Telegram-бот + n8n уже пишут данные в эти таблицы. Сделай красивый минималистичный дашборд на React + Vite + TailwindCSS + shadcn/ui + Recharts.

## Auth
- Email/Password через Supabase Auth
- Защищённые роуты — без логина редирект на `/login`
- В шапке: email пользователя + кнопка «Выйти»

## Структура

### Сайдбар / нижняя навигация (мобайл-фёрст)
- 📅 **Задачи**
- 💸 **Расходы**
- 🎯 **Цели**
- ⚙️ **Настройки**

### Страница «Задачи» (`/tasks`)
- Переключатель вида: список / календарь (week view)
- Список группирован по дням: «Сегодня», «Завтра», «На неделе»
- Каждая задача — карточка: время, заголовок, описание, чекбокс «выполнено» (меняет `status`)
- Кнопка фильтра по статусу
- Источник: таблица `tasks`, сортировка `starts_at asc`
- При клике на чекбокс — `update tasks set status='done'`

### Страница «Расходы» (`/expenses`)
- Сверху: **KPI**: «Сегодня», «Эта неделя», «Этот месяц» — три цифры
- Под ними: график (Recharts BarChart) расходов по дням за последние 30 дней
- Справа от графика: пирог (PieChart) — распределение по категориям за месяц
- Ниже: лента последних транзакций (таблица): дата, сумма, категория-чип, описание
- Фильтр сверху: период (день/неделя/месяц/всё), категория (мульти)
- Источник: `expenses` + join `expense_categories`

### Страница «Цели» (`/goals`)
- Сетка карточек: каждая — название цели, прогресс-бар, текущая/целевая сумма, дата
- Кнопка «+ Новая цель» — модалка с формой
- Виды целей: накопить (`savings`) или ограничить трату по категории (`spending_limit`)
- Для `spending_limit` — current_amount считается как сумма расходов за текущий месяц по category_id

### Страница «Настройки» (`/settings`)
- Подключить Telegram: показать инструкцию «напиши боту @<bot> команду /start, получи свой chat_id, вставь сюда» + поле для chat_id → insert в `telegram_users`
- Управление категориями: CRUD списка `expense_categories`
- Лимиты по категориям (`monthly_limit`)

## Дизайн
- Тёмная тема по умолчанию + переключатель
- Скруглённые карточки (`rounded-2xl`), мягкие тени
- Акцентный цвет — индиго/фиолетовый
- Иконки — `lucide-react`
- Адаптив: на мобиле сайдбар становится нижним табом

## Технические требования
- TypeScript строгий
- `@tanstack/react-query` для всех запросов к Supabase
- Realtime-подписки на `tasks` и `expenses` через `supabase.channel(...)` — обновление UI без перезагрузки когда n8n пишет новую строку
- Все суммы форматируем через `Intl.NumberFormat('ru-RU')`
- Даты — через `date-fns` с локалью `ru`

## Схема БД (только для справки, уже создана)

```sql
telegram_users(id, user_id, telegram_chat_id, username, created_at)
tasks(id, user_id, title, description, starts_at, ends_at, duration_minutes,
      google_event_id, status, raw_text, source, created_at, updated_at)
expense_categories(id, user_id, name, slug, color, icon, monthly_limit, created_at)
expenses(id, user_id, amount, currency, category_id, description, raw_text,
         source, occurred_at, created_at)
goals(id, user_id, name, kind, target_amount, current_amount, currency,
      category_id, target_date, created_at)
```

RLS включён — `auth.uid() = user_id` на всех таблицах. Дефолтные категории создаются автоматически при регистрации.
