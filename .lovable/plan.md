## Что не так сейчас

Прошёл по всем 22 страницам и нашёл системные расхождения:

**Шрифты**
- В `index.html` вообще не подключён шрифт — браузер рисует системным (на Mac San Francisco, на Windows Segoe UI → выглядит по-разному).
- В `index.css` нет `font-family` для body.

**Заголовки страниц (H1)** — 4 разных размера на одном уровне навигации:
- `text-3xl sm:text-4xl` → Дашборд, Метрики, Аналитика, Воронка, Подключение, Placeholder
- `text-2xl` → Настройки, Звонки, Отчёты
- `text-xl sm:text-2xl` → Финансы, Ads, ClientDashboard
- `text-4xl sm:text-5xl` → CreateStep1/2/3 (мастер — допустимо)

**Контейнеры страниц** — у каждой свой max-width:
- `max-w-[1500px]` Метрики, `max-w-[1600px]` Финансы, `max-w-7xl` Дашборд/Аналитика/Воронка/Отчёты, `max-w-6xl` Ads, `max-w-3xl` Placeholder, плюс страницы вообще без `container` (Settings, Crm, SettingsConnection).
- Паддинги: `py-6` / `py-8` вперемешку.

**Иконка-контейнеры в шапке страницы** — `h-9/h-10/h-12/h-14`, `rounded-lg/xl/2xl`, `bg-success/10` vs `bg-success/15`, ring есть/нет. Каждая страница на свой лад.

**Lucide-иконки** внутри — в основном `h-4 w-4` (246), но 113 раз `h-3 w-3`, 38 раз `h-5 w-5`, плюс случайные h-6/7/8. Внутри одной карточки часто разные размеры.

**Радиусы** — `rounded-md/lg/xl/2xl` рассыпаны без правила.

## Что делаю

### 1. Глобальная типографика (один раз, тянет всё)
- В `index.html` добавляю preconnect + `Inter` (400/500/600/700/800) и `JetBrains Mono` (для tabular цифр).
- В `index.css` ставлю `body { font-family: Inter, ui-sans-serif, system-ui... }`, `.tabular-nums { font-variant-numeric: tabular-nums; }`.
- В `tailwind.config.ts` расширяю `fontFamily: { sans: ['Inter', ...], mono: ['JetBrains Mono', ...] }`.

### 2. Единый компонент шапки страницы `PageHeader`
Новый файл `src/components/layout/PageHeader.tsx` — иконка-плашка `h-11 w-11 rounded-2xl bg-success/10 text-success`, H1 `text-2xl sm:text-3xl font-bold tracking-tight`, подзаголовок `text-sm text-muted-foreground`, слот справа для контролов. Заменяю руками собранные шапки во всех 12 страницах списка (Dashboard, Metrics, Analytics, Finance, Reports, Ads, Crm, Calls, Settings, SettingsConnection, CreativeFunnel, Placeholder, ClientDashboard, SalesAI).

### 3. Единая обёртка `PageContainer`
`src/components/layout/PageContainer.tsx` — `mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-fade-in-up`. Применяю на всех страницах вместо `container max-w-...`. Финансы остаются `max-w-[1600px]` через проп `wide`.

### 4. Стандарт иконок
Правило (правлю по страницам):
- Иконки в кнопках/инпутах/строках таблиц: `h-4 w-4`.
- Иконки в карточках-плашках (h-10/h-11): `h-5 w-5`.
- Иконки в крупных hero-плашках (h-14): `h-6 w-6`.
- Декоративные точки/индикаторы статуса: `h-2 w-2`.
Прохожу страницы и привожу к правилу; внутри одной строки/карточки — один размер.

### 5. Радиусы
Канон:
- Карточки и панели: `rounded-2xl`.
- Кнопки, инпуты, чипы: `rounded-xl`.
- Маленькие бейджи, аватары-плашки иконок: `rounded-lg` или `rounded-full`.
Привожу несовпадения внутри Metrics/Dashboard/Analytics/Reports/Ads/Crm/Settings.

### 6. KPI-карточки чисел
Везде число `text-3xl font-bold tabular-nums`, лейбл `text-xs uppercase tracking-wider text-muted-foreground`. Сейчас в Analytics `text-2xl`, в Metrics `text-3xl md:text-[2rem]`, в SalesAI `text-2xl` — выравниваю.

### 7. Проверка по странице
По каждой странице из списка пробегаю шапку → контейнер → KPI → таблицы/списки → кнопки. Финальный чек — скриншот превью на `/dashboard`, `/metrics`, `/analytics`, `/finance`, `/reports`, `/ads`, `/crm`, `/settings` через browser-screenshot, ищу остаточные расхождения.

## Что НЕ трогаю
- Логику данных, хуки, supabase — только presentation.
- CreateStep1/2/3 (онбординг-мастер с большой типографикой — намеренно другой).
- Цвета токенов в `:root` (palette уже единая).

## Технический раздел
Файлы новые: `src/components/layout/PageHeader.tsx`, `src/components/layout/PageContainer.tsx`.
Файлы правлю: `index.html`, `src/index.css`, `tailwind.config.ts`, плюс 14 страниц в `src/pages/` и несколько общих компонентов (`MoneyKpiCard`, `KpiCard`, `SummaryCard` в Metrics) для согласования размеров.

## Результат
Один шрифт на всё приложение. Одна высота шапки страницы. Один максимум ширины. Иконки трёх размеров по правилу. Радиусы по правилу. KPI-числа одного размера. Любая страница «как из одной коробки».
