## Цель

Сделать страницу **Показатели (Metrics)** единственным источником правды для всей аналитики (Dashboard, Сквозная аналитика, Отчёты). Любое ручное редактирование там → отображается везде. Плюс добавить учёт оплаты диагностик.

## Откуда сейчас приходит лишние 400 000

Сегодня Dashboard/Analytics/Reports считают по формуле:
```
Факт = CDI (Meta + ручной факт по кабинету) + orphan-CRM (лиды без cabinet_id)
```
Лид "Венера" (400 000) лежит в CRM без `cabinet_id` → попадает в orphan-блок, который суммируется поверх 800 000 из таблицы показателей. Отсюда 1 200 000.

В Metrics этот orphan-блок уже отделён как предупреждение, а в остальных местах — нет.

## Что меняем

### 1. CDI — добавить колонки оплат за диагностики
```
crm_diagnostic_revenue   numeric default 0   -- авто из CRM (сумма из попапа в этапе "Диагностика")
manual_diagnostic_revenue numeric default 0  -- ручной ввод в Metrics
```

### 2. CRM: попап "Сумма за диагностику"
- При переводе сделки в этап с `is_diagnostic = true` открывать диалог (по аналогии с PaymentPopover): сумма (можно 0), способ оплаты.
- Сохраняем в новую таблицу `diagnostic_payments(lead_id, amount, method, paid_at)` ИЛИ как `deals.service_type='diagnostic'` (предпочту deals, чтобы не плодить таблицы).
- Триггер `on_diagnostic_paid_attribution` → инкремент `cabinet_daily_insights.crm_diagnostic_revenue` (идемпотентно, как уже сделано для sales).

### 3. Таблица показателей (Metrics.tsx)
Колонки на кабинет/день:
```
Расход | Лиды | CPL  (auto из Meta)
Диагностики (шт) | Оплата за диагностику ₸  ← новое, редактируется
Продажи (шт)     | Выручка за продажи ₸     ← существующее, редактируется
Итого выручка = (оплата диагностик) + (выручка продаж)   ← вычисляется
ROMI = (Итого выручка − Расход) / Расход
```
Override-семантика остаётся: `manual_* > 0` → перезаписывает `crm_*`.

### 4. Единый хук `useTruthMetrics(range, cabinetId)`
Один источник для Dashboard / Analytics / Reports / Metrics:
```ts
{
  spend, leads, cpl,
  diagnostics, diagnosticRevenue,
  sales, salesRevenue,
  revenue: diagnosticRevenue + salesRevenue,
  romi
}
```
Внутри читает только `cabinet_daily_insights` с override-логикой. **Orphan-CRM больше НЕ суммируется в "Факт"** — выносится в отдельный блок "Несвязанные заявки" с предупреждением и кнопкой "Привязать к кабинету" (как сейчас в Metrics, но во всех разделах).

### 5. Переключение страниц на единый хук
- `useDashboardData.ts` — заменить `factRevenue/factSales/factDiagnostics` на `useTruthMetrics`.
- `useReportData.ts` — `computeTotals` берёт `diagnosticRevenue`, orphan убираем из totals.
- `Analytics` / `Финансы` — те же поля.

### 6. UI Metrics
- Новая колонка "Оплата за диагностику" с inline-Pencil редактором (как у Manual sales).
- Под таблицей карточка "Итого по периоду", показывающая ровно те же числа, что Dashboard.
- Бейдж "Источник правды" → на всех страницах ссылка ведёт сюда.

## Технические детали

**Миграции:**
```sql
ALTER TABLE cabinet_daily_insights
  ADD COLUMN crm_diagnostic_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN manual_diagnostic_revenue numeric NOT NULL DEFAULT 0;

CREATE FUNCTION on_diagnostic_paid_attribution() …  -- триггер на deals (service_type='diagnostic')
```

**Файлы:**
- `src/hooks/useTruthMetrics.ts` — новый
- `src/pages/Metrics.tsx` — +колонка, +строка "Итого выручка"
- `src/components/crm/StageColumn.tsx` (или место смены стадии) — открывать `DiagnosticPaymentPopover` при переходе в этап с `is_diagnostic`
- `src/components/crm/lead/DiagnosticPaymentPopover.tsx` — новый (клон PaymentPopover)
- `src/hooks/useDashboardData.ts`, `src/hooks/useReportData.ts`, `src/pages/Analytics.tsx` — переход на `useTruthMetrics`
- supabase migration

**Совместимость:** существующие manual_sales / manual_revenue не трогаем, только добавляем диагностики.

## Результат
- В Metrics видно 2 диагностики / 2 продажи / 800 000 → ровно те же числа в Dashboard, Сквозной аналитике, Отчётах.
- Orphan-лид "Венера" показывается отдельным предупреждением, не задваивает сумму.
- При записи сделки в этап "Диагностика" менеджер сразу вносит сумму оплаты диагностики (или 0) — она автоматом подтягивается в Metrics → во всю аналитику.
