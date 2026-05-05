## Что делаем

1. **Убираем метрику "Выручка (Meta)"** из карточки кабинета (`src/components/ads/CabinetRow.tsx`). Этот столбец показывал поле `revenue` из `cabinet_daily_insights` — в Meta Ads оно почти всегда 0 (это revenue из пикселя/событий, а реальные продажи у вас в CRM/тенге). Поле пока оставим в БД, просто не отображаем. Сетку метрик ужмём до 5 колонок.

2. **Конвертация USD → KZT по курсу НБ РК на дату**:
   - Создаём новую таблицу `fx_rates` (date PK, usd_kzt numeric). Хранит курсы по дням, кэш.
   - Создаём edge function `fx-rate` — по запросу даты тянет курс с публичного API НБ РК (`https://nationalbank.kz/rss/get_rates.cfm?fdate=DD.MM.YYYY`, формат XML, без ключа), парсит USD, кладёт в `fx_rates`. Если уже есть — отдаёт из кэша.
   - В `meta-daily-sync` (и в одноразовом `meta-insights`) после получения `spend` в валюте кабинета: если `currency !== 'KZT'`, для каждой даты получаем курс через `fx_rates` (или НБ РК), пересчитываем `spend = spend_usd * rate`, аналогично `cpl/cpm/cpc/revenue`. В БД сохраняем уже в тенге, `currency = 'KZT'`.
   - Для дат без курса (выходные/праздники НБ РК) — берём ближайший предыдущий рабочий день.

3. **Отображение валюты**:
   - Все цифры по кабинету теперь в KZT — `formatMoney` будет получать `currency='KZT'` автоматически из БД.
   - В шапке кабинета можно показать справочно "Валюта аккаунта: USD → KZT (курс НБ РК)" мелким текстом, чтобы было прозрачно.

4. **Пересчёт исторических данных**: добавляем кнопку "Пересчитать в тенге" в меню кабинета — вызывает `meta-daily-sync` с `force=true` для текущего месяца, перезаписывая `cabinet_daily_insights` уже сконвертированными значениями.

## Технические детали

- **Таблица** `fx_rates`: `date date primary key`, `usd_kzt numeric not null`, `source text default 'nbk'`, `fetched_at timestamptz`. RLS: select для authenticated, write только service role (через edge function).
- **Edge function `fx-rate`**: GET `?date=YYYY-MM-DD` → `{ rate: 470.12 }`. Использует `SUPABASE_SERVICE_ROLE_KEY` для записи в `fx_rates`. CORS включаем.
- **Изменения в `meta-daily-sync/index.ts`**: после fetch insights — собираем уникальные даты, батчем получаем курсы (один select из `fx_rates` + добор недостающих через НБ РК), умножаем spend/revenue на курс, сохраняем `currency:'KZT'`.
- **Изменения в `meta-insights/index.ts`**: аналогично для on-demand расчёта.
- **UI**: убираем 6-й `<Metric>` в `CabinetRow.tsx`, меняем `lg:grid-cols-6` → `lg:grid-cols-5`.

## Файлы

- migration: `fx_rates` + RLS
- new: `supabase/functions/fx-rate/index.ts`
- edit: `supabase/functions/meta-daily-sync/index.ts`, `supabase/functions/meta-insights/index.ts`
- edit: `src/components/ads/CabinetRow.tsx` (убрать Meta-выручку, грид)
