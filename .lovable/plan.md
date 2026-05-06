## Проблемы

### 1. Данные не переключаются при смене проекта (нужно обновлять страницу)
- `useLeadsLite` (Dashboard, Analytics, Reports, Metrics) **вообще не фильтрует по `project_id`** — всегда грузит ВСЕ лиды. Поэтому CRM-данные одинаковые для всех проектов.
- `useReportData` зависит от `leads.length`, но не от `activeId` — при смене проекта эффект не перезапускается, пока количество лидов случайно не совпадёт.
- `useCabinetsStore` фильтрует по `project_id`, но `usePersonalCabinets` отдаёт `cabinets`, которые меняются после async refetch — между моментами Dashboard видит «чужие» кабинеты.

### 2. Везде висит знак `$` вместо тенге
Жёстко прописано в 8 местах:
- `src/pages/Dashboard.tsx` (`fmtTenge` → `… $`)
- `src/pages/Analytics.tsx` (`fmtMoney` → `$…`)
- `src/pages/Metrics.tsx` (`formatTenge` → `… $`)
- `src/components/dashboard/`: `EnhancedFunnel.tsx`, `ChannelsTable.tsx`, `RevenueSpendChart.tsx`, `UnitEconomicsCard.tsx`, `CampaignsTopBottom.tsx`
- `src/components/analytics/ChannelCard.tsx`
- `src/components/ads/CabinetRow.tsx`: `CURRENCY_SYMBOLS.KZT = "$"` (!)

### 3. Ручные данные кабинета (диагностика/продажа/сумма) не попадают в Dashboard и Analytics
В `/ads` ввод сохраняется в `cabinet_daily_insights.manual_diagnostics / manual_sales / manual_revenue`. Это видит только `useMetaInsights` (страница /metrics). Dashboard и Analytics берут продажи и выручку **только из CRM-лидов** (`leads.stageKey === "paid"`), игнорируя `manual_*` и `crm_*` поля CDI.

---

## План исправлений

### A. Единый фильтр по активному проекту

**`src/hooks/useLeadsLite.ts`**
- Подключить `useProjectsStore`, добавить в SELECT условие `.or('project_id.eq.{activeId},project_id.is.null')`.
- В `useEffect` зависимость от `activeId`, чтобы при смене проекта данные перезапрашивались.
- Realtime-канал переподписать с фильтром по проекту.

**`src/hooks/useReportData.ts`**
- Добавить `activeId` в зависимости эффекта (через `cabinetIds` уже частично решается, но `leads` приходят отфильтрованные после фикса A).

**`src/hooks/useCabinetsStore.ts`**
- В `useRealtimeTable` добавить debounce + ререндер при смене `projectId` (уже есть `refetch` зависимость — ок, но добавить `setCabinets([])` пока идёт refetch, чтобы не показывать старое).

### B. Ввести единый формат валюты — тенге (₸)

Создать `src/lib/format.ts`:
```ts
export const fmtKzt = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU")} ₸`;
export const fmtNum = (n: number) =>
  Math.round(n).toLocaleString("ru-RU");
```

Заменить все локальные `fmtTenge / fmtMoney / formatTenge` на импорт `fmtKzt`. Поправить:
- `Dashboard.tsx`, `Analytics.tsx`, `Metrics.tsx`
- `dashboard/EnhancedFunnel.tsx`, `ChannelsTable.tsx`, `RevenueSpendChart.tsx`, `UnitEconomicsCard.tsx`, `CampaignsTopBottom.tsx`
- `analytics/ChannelCard.tsx`
- В `CabinetRow.tsx`: `CURRENCY_SYMBOLS.KZT = "₸"`, `CURRENCY_SYMBOLS.USD = "$"` (для агентских USD-кабинетов сохраняется конверсия, которую мы уже сделали через `fx-rate`).

### C. Объединить ручные и CRM-данные кабинетов в общую аналитику

В `useReportData.ts` помимо `spend/leads` тянуть из `cabinet_daily_insights` ещё и `crm_sales, manual_sales, crm_revenue, manual_revenue, crm_diagnostics, manual_diagnostics`.

В `computeTotals` объединить:
```
totals.sales   = crm.sales.length + Σ(manual_sales + crm_sales из CDI)
totals.revenue = Σ(lead.amount из paid) + Σ(manual_revenue + crm_revenue из CDI)
totals.visits  = crm.visits.length + Σ(manual_diagnostics + crm_diagnostics)
```

Чтобы не дублировать — триггеры `on_deal_paid_attribution` и `on_lead_stage_change_attribution` уже пишут CRM-события в `cabinet_daily_insights.crm_*`. Значит:
- Берём revenue/sales/diagnostics ТОЛЬКО из CDI (`crm_* + manual_*`), а не из `leads` напрямую — это и устраняет дублирование, и даёт «единый источник правды».
- В `useDashboardData.timeseries` revenue по дням брать из CDI (`crm_revenue + manual_revenue`).
- `channels` в `useDashboardData` — оставить как есть (источник трафика — это срез по `leads.source`).

### D. Реалтайм для CDI

Добавить таблицу `cabinet_daily_insights` в `supabase_realtime` publication (миграция), чтобы Dashboard/Analytics обновлялись сразу после ввода в `/ads`.

---

## Технические детали

| Файл | Изменение |
|---|---|
| `src/lib/format.ts` (новый) | `fmtKzt`, `fmtNum` |
| `src/hooks/useLeadsLite.ts` | Фильтр по `activeId` + перезапуск при смене |
| `src/hooks/useReportData.ts` | Тянуть `crm_*/manual_*`; считать totals из CDI; использовать `monthlyMeta` для revenue по дням |
| `src/hooks/useDashboardData.ts` | Брать `revenue` из новой структуры monthlyMeta (включая manual) |
| 8 компонентов с валютой | Импорт `fmtKzt`, удалить локальные функции |
| `src/components/ads/CabinetRow.tsx` | `KZT: "₸"` |
| миграция | `ALTER PUBLICATION supabase_realtime ADD TABLE public.cabinet_daily_insights;` |

После этих правок:
- Смена проекта → данные обновляются сразу (без F5).
- Везде ₸ вместо $.
- Ручные диагностики/продажи/выручка из `/ads` появляются в Дашборде и Аналитике рядом с CRM-данными — единый аналитический центр.
