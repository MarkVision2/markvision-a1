# ТЗ для Lovable — Финансовый планировщик «Personal Assistant»

> Вставь этот текст в новый Lovable-проект как первое сообщение. Он подключит существующий Supabase (см. ниже) и построит весь UI. Supabase-схема уже создана — приложение только читает/пишет в неё.

---

## КОНЦЕПЦИЯ

Я делаю личный финансовый ассистент. Бэкенд — Supabase (готов), Telegram-бот на n8n уже умеет принимать голос/текст и писать данные в БД. Нужен фронт-дашборд, который:

1. Показывает **расходы**, **доходы**, **цели**, **кредиты** в одном красивом интерфейсе
2. Имеет CRUD по всем сущностям прямо в UI (на случай когда лень писать боту)
3. Реалтайм-обновление: когда бот пишет данные в Supabase — UI сразу видит без перезагрузки
4. Минималистичный тёмный UI, мобайл-фёрст, акцентный цвет **индиго**
5. Auth через email/пароль Supabase

## ТЕХНОЛОГИИ

- **React 18 + Vite + TypeScript** (строгий)
- **TailwindCSS** + **shadcn/ui** компоненты
- **Recharts** для графиков
- **@supabase/supabase-js** v2
- **@tanstack/react-query** для всех Supabase-запросов
- **react-hook-form** + **zod** для форм
- **date-fns** с локалью `ru`
- **lucide-react** для иконок
- **react-router-dom** для роутинга
- **Intl.NumberFormat('ru-RU')** для форматирования сумм

## ПОДКЛЮЧЕНИЕ К SUPABASE

При создании Lovable спросит подключение Supabase — соглашайся, потом вставь:

| Поле | Значение |
|------|----------|
| Project URL | `https://lsgwjiwzaillykuqegxb.supabase.co` |
| Anon / Publishable key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzZ3dqaXd6YWlsbHlrdXFlZ3hiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODgwMzgsImV4cCI6MjA5NTQ2NDAzOH0.4PgqAWL4einCmbsg_euN672Ca1FrwcJ-prm8qai1MGo` |

RLS уже включён — публичный ключ безопасен. Никогда не давай `service_role` ключ фронту.

## АУТЕНТИФИКАЦИЯ

- Email + Password через Supabase Auth
- Страница `/login` — две формы (вход/регистрация)
- При входе — редирект на `/` (Dashboard)
- Защищённые роуты — если не залогинен, редирект на `/login`
- В шапке: email + кнопка «Выйти»

## ДИЗАЙН (важно)

- **Тёмная тема по умолчанию**, переключатель день/ночь в настройках
- Фон — глубокий тёмный (`#0a0a0f` или Tailwind `zinc-950`)
- Карточки: `bg-zinc-900/60 backdrop-blur rounded-2xl border border-zinc-800/50`
- Акцентный цвет — **индиго `#6366f1`** (для активных табов, прогресс-баров, CTA)
- Числа сумм — крупный моноширинный шрифт (`font-mono` или `tabular-nums`)
- Анимации — `framer-motion`: появление карточек, плавные переходы между табами
- Иконки — `lucide-react`, размер 18–20px
- На мобиле — нижняя навигация (5 табов), на десктопе — сайдбар слева

## СТРУКТУРА (роуты)

```
/                — Dashboard (общий обзор)
/expenses        — Расходы
/incomes         — Доходы
/goals           — Цели
/debts           — Кредиты и обязательства
/tasks           — Задачи (из календаря)
/settings        — Настройки
/login           — Логин
```

Нижняя навигация на мобиле / сайдбар на десктопе:
- 🏠 Главная (`/`)
- 💸 Расходы (`/expenses`)
- 💰 Доходы (`/incomes`)
- 🎯 Цели (`/goals`)
- 🏦 Кредиты (`/debts`)
- (в меню «ещё»: Задачи, Настройки)

---

## СТРАНИЦА: ГЛАВНАЯ (`/`)

Сверху — приветствие: «Привет, <имя из email>».

### Блок 1: Финансовый снапшот (3 карточки в ряд, mobile — стек)
- **Баланс месяца**: `доходы - расходы` за текущий месяц, крупная цифра ₽. Цвет: зелёный если +, красный если −. Сабтайтл: «vs предыдущий месяц: +X%»
- **Расходы (этот месяц)**: сумма + спарклайн за последние 30 дней
- **Доходы (этот месяц)**: сумма + динамика

### Блок 2: График «Cashflow за 12 месяцев»
Recharts ComposedChart:
- Зелёные столбцы — доходы
- Красные столбцы — расходы
- Синяя линия — баланс (накопительная или месячная)
- Источник: VIEW `monthly_balance` из Supabase (`SELECT * FROM monthly_balance ORDER BY month`)

### Блок 3: Активные цели (горизонтальный скролл карточек)
Каждая карточка цели: иконка, название, текущая / целевая сумма, прогресс-бар, % выполнения, ETA (если есть `target_date`).

### Блок 4: Кредиты — сводка
Из VIEW `debts_summary`: активных N, осталось выплатить ₽, месячный платёж ₽. Маленький прогресс по каждому активному кредиту.

### Блок 5: Лента последних транзакций (5 шт)
Объединённая лента из `expenses` + `incomes` отсортированная по дате. Расход = красная стрелка вниз, доход = зелёная стрелка вверх.

---

## СТРАНИЦА: РАСХОДЫ (`/expenses`)

### Фильтры (сверху, в одну строку)
- Период: Сегодня / Неделя / Месяц / 3 месяца / Год / Всё / Кастомный (date-range picker)
- Категория (мульти-селект)
- Поиск по `description`

### KPI (3 цифры в ряд)
- **Всего за период** — большая цифра
- **Средний день** — `sum / N дней`
- **Топ-категория** — самая большая категория за период

### Графики (2 в ряд, на мобиле — стек)
- BarChart по дням за период
- PieChart распределение по категориям (с легендой)

### Прогресс по категориям с лимитами
Для каждой `expense_categories` где `monthly_limit IS NOT NULL`: имя + потрачено/лимит + горизонтальный прогресс-бар (зелёный → жёлтый при 70% → красный при 100%).

### Таблица транзакций (виртуализированная если >100 строк)
Колонки: дата (relative — «сегодня», «вчера», иначе `dd.MM.yyyy HH:mm`), категория (чип с цветом), сумма, описание.
Клик по строке → модалка с деталями + кнопка «Удалить» (с confirm).

### Кнопка «+ Расход» (FAB снизу-справа)
Открывает модалку: amount (number), currency (select), category (select), description, occurred_at (datetime). По умолчанию `occurred_at = now()`, currency = RUB.

---

## СТРАНИЦА: ДОХОДЫ (`/incomes`)

Аналогично расходам, но цвет акцента — **зелёный**. Дополнительно:

### Раздел «По клиентам»
Группировка `incomes` по `client_name` (где не null), сортировка по сумме за период.
Колонки: клиент, кол-во платежей, сумма всего, последний платёж.
Это важно для фриланса — видеть кто сколько принёс.

### Кнопка «+ Доход»
Поля: amount, currency, category (select из `income_categories`), client_name (autocomplete по существующим), description, received_at.

---

## СТРАНИЦА: ЦЕЛИ (`/goals`)

### Сетка карточек (3 колонки на десктопе, 1 на мобайле)
Каждая карточка:
- Иконка + название (крупно)
- Прогресс-бар (большой, акцент-цвет)
- `current_amount` / `target_amount` — крупная цифра под прогрессом
- % выполнения
- Если есть `target_date`: дней осталось + «нужно откладывать X ₽/мес чтобы успеть»
- Кнопка-чип «+ внести» — открывает мини-форму (`goal_contributions` INSERT)
- Меню «⋯»: Редактировать / Архивировать / Удалить

### История по цели (модалка при клике)
Список из `goal_contributions` для этой goal: дата, сумма (+/−), note.

### Кнопка «+ Новая цель»
Модалка: name, kind (savings_target / spending_limit / asset_purchase), target_amount, currency, target_date (опц), icon, color, description.

### Типы целей — отображение
- `savings_target` — копить (квартира, машина) → прогресс к target
- `asset_purchase` — то же что savings, но с пометкой «покупка»
- `spending_limit` — лимит по категории → красный если превышен
- `debt_payoff` — связан с конкретным debt_id, прогресс = (initial − current) / initial

---

## СТРАНИЦА: КРЕДИТЫ (`/debts`)

### Сверху — общая статистика (карточки)
- Всего активных кредитов: N
- Общий остаток ₽
- Ежемесячный платёж ₽
- Через сколько закрою всё (если все будут платиться по `monthly_payment`)

### Список кредитов (карточки в столбец)
Каждая карточка:
- Название (крупно) + тип-чип (loan, credit_card, ...)
- Прогресс-бар: выплачено / общая сумма + %
- `initial_amount` → `current_balance` (выплачено X из Y)
- Процентная ставка, ежемесячный платёж, конечная дата (если есть)
- Кнопка «💵 Внести платёж» — модалка: amount, paid_at. После сабмита — INSERT в `debt_payments`. Триггер в БД сам уменьшит `current_balance` и закроет кредит если 0.
- Меню «⋯»: Редактировать / Архивировать / История платежей

### История платежей (модалка)
Список `debt_payments` для конкретного `debt_id` по убыванию даты. Можно удалить платёж — триггер откатит.

### Кнопка «+ Новый кредит»
Модалка: name, kind, initial_amount, current_balance (по умолчанию = initial), interest_rate, monthly_payment, start_date, end_date, description.

---

## СТРАНИЦА: ЗАДАЧИ (`/tasks`)

(Уже частично описано в первой версии — оставь.)
- Переключатель: список / неделя-календарь
- Группировка по дням: Сегодня, Завтра, На неделе, Позже
- Каждая задача — карточка с чекбоксом (меняет `status` на 'done')
- Фильтр: pending / done / cancelled / все
- Кнопка «+ Задача» (модалка с time picker)

---

## СТРАНИЦА: НАСТРОЙКИ (`/settings`)

### Раздел «Профиль»
- Email (readonly)
- Кнопка сменить пароль

### Раздел «Telegram»
- Поле «Мой chat_id» — INSERT/UPDATE в `telegram_users`
- Инструкция: «Чтобы привязать Telegram, напиши боту @userinfobot — он скажет твой chat_id. Вставь сюда — после этого бот начнёт принимать твои сообщения.»

### Раздел «Категории расходов»
CRUD таблицы `expense_categories`. Для каждой: name, slug (auto от name), color (color picker), icon (autocomplete lucide), monthly_limit.

### Раздел «Категории доходов»
То же самое для `income_categories`.

### Раздел «Тема»
Переключатель тёмная/светлая.

### Раздел «Валюта по умолчанию»
Select: RUB / USD / EUR / KZT / UAH. Сохраняется в localStorage.

---

## РЕАЛТАЙМ

Подписаться на `tasks`, `expenses`, `incomes`, `debt_payments`, `goal_contributions` через `supabase.channel(...)`:
```ts
const ch = supabase.channel('public:expenses')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, (payload) => {
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
  })
  .subscribe()
```
Когда n8n пишет новую строку — UI моментально показывает её без F5.

## СХЕМА БД (для справки — уже создана)

```sql
telegram_users(id, user_id→auth.users, telegram_chat_id, username, created_at)

tasks(id, user_id, title, description, starts_at, ends_at, duration_minutes,
      google_event_id, status pending|done|cancelled, raw_text, source,
      created_at, updated_at)

expense_categories(id, user_id, name, slug, color, icon, monthly_limit, created_at)
expenses(id, user_id, amount, currency, category_id, description, raw_text,
         source, occurred_at, created_at)

income_categories(id, user_id, name, slug, color, icon, created_at)
incomes(id, user_id, amount, currency, category_id, client_name, description,
        raw_text, source, received_at, created_at)

debts(id, user_id, name, kind, initial_amount, current_balance, currency,
      interest_rate, monthly_payment, start_date, end_date, is_closed,
      closed_at, description, created_at, updated_at)
debt_payments(id, user_id, debt_id, amount, paid_at, raw_text, source, created_at)

goals(id, user_id, name, kind savings|spending_limit|asset_purchase|debt_payoff,
      target_amount, current_amount, currency, category_id, target_date,
      icon, color, description, is_archived, created_at, updated_at)
goal_contributions(id, user_id, goal_id, amount, occurred_at, note, raw_text,
                   source, created_at)

-- Views
monthly_balance(user_id, month, income_total, expense_total, balance)
debts_summary(user_id, active_count, total_remaining, total_initial, total_monthly)
```

RLS на всех таблицах: `auth.uid() = user_id`. Дефолтные категории (7 расходных + 5 доходных) автоматически создаются при регистрации триггерами.

## БИЗНЕС-ЛОГИКА БЭКА (что делает Telegram-бот за кадром)

Понимать что бот ВНЕ Lovable, отдельный сервис на n8n. Когда я пишу боту:
- «потратил 1500 на обед» → INSERT в `expenses`
- «поступила оплата 50000 от клиента Иван» → INSERT в `incomes` с `client_name='Иван'`
- «внёс по ипотеке 30000» → INSERT в `debt_payments` (бот сам найдёт нужный `debt_id` через AI-match к существующим долгам), триггер уменьшит `current_balance`
- «положил 10к на квартиру» → INSERT в `goal_contributions` (AI найдёт цель с name~="квартира"), триггер обновит `current_amount`
- «завтра в 15 встреча» → INSERT в `tasks` + событие в Google Calendar
- «отмени встречу» → UPDATE `tasks.status='cancelled'` + DELETE из Calendar

Фронт ничего из этого не делает — только показывает данные и даёт CRUD. Бот = быстрый ввод голосом, Lovable = красивая визуализация и редактирование.

## КАЧЕСТВО КОДА

- TypeScript strict, без `any`
- Все запросы — через `@tanstack/react-query` с правильными `queryKey`-ями
- Lazy-load графиков (Recharts тяжёлый)
- Skeleton-лоудеры на каждой странице
- Error boundaries — каждая страница в своём boundary с retry-кнопкой
- Пустые состояния (Empty States) с CTA и иллюстрацией для каждой страницы
- Toast-уведомления (`sonner` или shadcn `useToast`) на успех/ошибку всех мутаций
- Все формы с zod-валидацией
- Адаптив проверять на 375px, 768px, 1280px

## СНАЧАЛА СДЕЛАЙ

1. Layout + Sidebar/BottomNav + тёмная тема
2. Авторизацию (login страница + защищённые роуты)
3. Главная — статистика + графики (это даст «вау»-эффект)
4. Расходы CRUD
5. Доходы CRUD
6. Цели CRUD
7. Кредиты CRUD
8. Задачи
9. Настройки + категории
10. Реалтайм везде
11. Полишинг (анимации, пустые состояния, скелетоны)
