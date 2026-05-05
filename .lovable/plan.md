## Цель

Перевести всю систему MarkVision AI на единый минималистичный стиль из скриншота: глубокий тёмно-синий фон, изумрудный акцент, чёткая типографика, высокий контраст, без обилия цветов.

## Палитра (single source of truth — `src/index.css`)

```text
Background:    deep navy   #0B1420  (hsl 215 45% 8%)
Surface/Card:  navy-800    #0F1B2D  (hsl 215 40% 12%)
Surface-2:     navy-700    #14233A  (hsl 215 38% 16%)
Border:        slate-700   #1F2E47  (hsl 215 30% 20%)
Foreground:    near-white  #E6EEF7  (hsl 210 30% 94%)
Muted text:    slate-400   #8AA0BC  (hsl 215 20% 64%)
Primary/Accent: emerald    #22C39A  (hsl 162 70% 45%)  ← единственный цветной акцент
Primary glow:  emerald-300 (hsl 162 70% 55%)
Destructive:   coral 0 72% 55%   (используется ТОЛЬКО для ошибок/удаления)
Warning:       amber 38 92% 58%  (только для SLA-алёртов)
```

Никаких фиолетовых градиентов, никаких розовых/синих свечений. Один акцент = emerald.

## Что меняется

### 1. Дизайн-токены (`src/index.css`, `tailwind.config.ts`)
- Переписать `:root` и `.dark` под новую палитру.
- Заменить `--gradient-primary` на тонкий emerald-градиент (135deg, emerald → emerald-glow), `--gradient-hero` на бело-слейт текстовый градиент.
- Убрать фиолетовые radial-gradients из `body` background-image — оставить чистый плоский фон + одно очень слабое emerald-свечение сверху (opacity ≤ 0.06).
- `--shadow-glow` → `0 0 32px hsl(162 70% 45% / 0.25)`.
- `--radius`: 0.75rem (чуть строже).

### 2. Сайдбар (`src/components/layout/AppSidebar.tsx`, `ProjectSwitcher.tsx`)
- Фон сайдбара = `--background` (как на скриншоте — слитный с контентом, разделён только бордером).
- Активный пункт: emerald-фон 12% + emerald-текст + левый бордер 2px emerald.
- Иконки: muted в обычном, emerald в активном/hover.
- Логотип-плашка проекта: emerald-градиент, скругление xl.
- Убрать любые фиолетовые тени/градиенты.

### 3. Хедер / топбар (`src/components/factory/Header.tsx` и хедер AppLayout)
- Плашка лого: emerald gradient, glow убрать (только subtle).
- Поле «Спросите ИИ…»: широкое, плоское, бордер `--border`, focus-ring emerald.

### 4. Карточки KPI (CrmKpiBar, MoneyKpiCard, KpiCard, UnitEconomicsCard)
- Единый стиль: surface bg, border 1px, radius lg, padding 5–6.
- Иконка в квадрате 40×40 со скруглением md, фон `emerald/12`, цвет emerald.
- Заголовок UPPERCASE 11px tracking-wider muted, значение 28–32px semibold, подпись 12px muted.
- Без градиентов внутри карточек.

### 5. Табы и кнопки
- Tabs: контейнер surface, активный таб = emerald/15 фон + emerald текст. Остальные — muted.
- Primary button: emerald solid, hover чуть светлее, без heavy shadow-glow (только subtle).
- Secondary/outline: border `--border`, hover surface-2.

### 6. Воронка / Kanban (StageColumn, LeadCard)
- Колонки: surface bg, бордер, header с иконкой стадии (emerald accent для активных стадий, muted для прочих).
- Карточки лидов: surface-2, hover чуть светлее + emerald-border на 1px.
- Drag-over состояние: emerald dashed border + emerald/8 фон.

### 7. Контент-завод и страницы создания
- ContentTypeCard / SourceModeCard: убрать `bg-gradient-card-hover` (фиолет), заменить на emerald hover overlay.
- Hero: текстовый градиент через `--gradient-hero` (бело-слейт), без фиолета.

### 8. Формы, инпуты, диалоги
- Input/Textarea/Select: bg `--secondary`, border `--border`, focus emerald ring.
- Dialog/Sheet: bg `--popover`, border, без backdrop-blur тяжёлых эффектов.

### 9. Графики (Recharts wrappers — RevenueSpendChart, MonthlyDynamics и т.п.)
- Основной цвет линий/баров: emerald. Второй ряд: slate-400. Сетка: `--border` с opacity.
- Tooltip: surface-2 + border + emerald accent.

### 10. Логин / Auth (`Login.tsx`, `AuthForm.tsx`, `MarketingPanel.tsx`)
- Убрать фиолетовые градиенты, заменить на emerald accent + плоский navy фон.

## Производительность

- Удалить тяжёлый `background-attachment: fixed` + двойные radial-gradients из body — оставить плоский фон (быстрее на скролле).
- Убрать `backdrop-blur-xl` со sticky header → `backdrop-blur-sm` или вовсе solid bg (заметно быстрее на слабых машинах).
- Снизить количество `shadow-elevated`/`shadow-glow` — оставить только на primary CTA и активной карточке проекта.

## Что НЕ трогаем

- Структуру компонентов, роутинг, бизнес-логику, Supabase, edge-функции.
- Иконки (lucide-react остаётся).
- Содержимое страниц.

## Файлы (основные правки)

- `src/index.css` — палитра + градиенты + body bg
- `tailwind.config.ts` — при необходимости (цвета берутся из CSS-переменных, скорее всего без изменений)
- `src/components/layout/AppSidebar.tsx`, `AppLayout.tsx`, `ProjectSwitcher.tsx`
- `src/components/factory/Header.tsx`, `Hero.tsx`, `ContentTypeCard.tsx`, `SourceModeCard.tsx`
- `src/components/crm/CrmKpiBar.tsx`, `StageColumn.tsx`, `LeadCard.tsx`, `SlaAlerts.tsx`
- `src/components/dashboard/*` — KPI и графики
- `src/components/reports/KpiCard.tsx`
- `src/components/auth/*`, `src/pages/Login.tsx`
- Точечно: убрать классы `bg-gradient-card-hover`, `shadow-glow` где они визуально лишние.

## Результат

Единый чёткий дизайн как на референсе: navy + emerald, высокая читаемость, минимум эффектов, заметно более быстрый рендер.
