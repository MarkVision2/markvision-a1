## Цель

В разделе **Список рекламных кабинетов** (/ads) сделать так, чтобы по каждому кабинету **за каждый день и за месяц** автоматически считались данные из CRM:

- **Диагностики** — сколько лидов из этого кабинета пришло на диагностику (визит / встречу)
- **Продажи (шт.)** — сколько сделок оплачено по этим лидам
- **Сумма продаж (₸/$)** — выручка из CRM по этим лидам

Плюс возможность вручную добавить/скорректировать «диагностики» по дню (если CRM не покрывает).

Прямая интеграция: лид → пришёл с этого кабинета → попал в CRM → дошёл до этапа «диагностика»/оплачено → цифры моментально появились в карточке кабинета и в дневной таблице.

## Схема связи лидов с кабинетом

Сейчас в `leads` нет ссылки на `ad_cabinets`. Связь слабая — только через project_id и `utm`. Это надо починить.

### Миграция БД

1. Добавить в `leads`:
   - `cabinet_id uuid` (nullable, индекс)
   - триггер «при INSERT, если cabinet_id пуст, попробовать определить по `utm->>utm_source` = external_id кабинета или по `utm->>utm_campaign` = name»

2. Расширить `cabinet_daily_insights` ручными CRM-полями (агрегаты, обновляются триггерами):
   - `crm_diagnostics integer not null default 0`
   - `crm_sales integer not null default 0`
   - `crm_revenue numeric not null default 0`
   - `manual_diagnostics integer not null default 0` (правка вручную)
   - уникальный ключ `(cabinet_id, date)` (сейчас уникальность по `external_id,date`, добавим)

3. Стадия «диагностика»: добавить в `pipeline_stages` опциональный флаг `is_diagnostic boolean default false`. В UI настроек дать чекбокс «Это этап диагностики». Считаем диагностикой переход лида в любую такую стадию.

4. Триггеры (SECURITY DEFINER):
   - `on_lead_stage_change` (расширить существующий) — если новая стадия `is_diagnostic = true` и лид имеет `cabinet_id`, инкрементировать `crm_diagnostics` в `cabinet_daily_insights` за дату перехода (создать строку, если её нет — `upsert`).
   - `on_deal_change` (расширить существующий) — при переходе сделки в `paid` и наличии `cabinet_id` у её лида: `crm_sales += 1`, `crm_revenue += amount` за дату оплаты.

   Триггеры идемпотентны: храним в `events` тип `cabinet_attributed` с payload `{kind, deal_id|stage_id}`, перед инкрементом проверяем, что такого события ещё не было.

### Backfill

Один раз пересчитать существующие данные:
- по всем лидам с `cabinet_id` пройтись по `lead_status_history` → собрать диагностики по дате
- по всем `deals.status='paid'` → собрать продажи/выручку по `paid_at`
- записать в `cabinet_daily_insights`

## UI: страница /ads

### Карточка кабинета (`CabinetRow.tsx`) — шапка
Добавить две метрики рядом с «Лиды/CPL/Выручка»:
- **Диагн.** — сумма `crm_diagnostics + manual_diagnostics` за месяц
- **Продажи** — `crm_sales` (шт.) и под ним мелким — `crm_revenue` (сумма)

«Выручка» переименовать в **«Выручка (Meta)»**, чтобы не путать с CRM-выручкой; CRM-выручка — отдельный столбик «CRM ₽».

### Карточка кабинета — раскрытая дневная таблица
Добавить столбцы справа:
| Дата | Расход | Показы | Клики | Лиды | CPL | **Диагн.** | **Продажи** | **Сумма CRM** |

- Ячейка «Диагн.» — кликабельная: открывается popover с inline-полем «Добавить вручную +N» (пишет в `manual_diagnostics`). Изменения сохраняются сразу через realtime обновляется UI.
- «Продажи» и «Сумма CRM» — read-only, тянутся из CRM автоматически.

### Хук данных
Расширить `useMetaInsights` → `useCabinetInsights`:
- Тянуть из `cabinet_daily_insights` дополнительно `crm_diagnostics, manual_diagnostics, crm_sales, crm_revenue`.
- Возвращать в `totals` агрегаты `diagnostics, sales, crmRevenue`.
- Подписаться на realtime `cabinet_daily_insights` для этого кабинета — любые изменения CRM (новый оплаченный лид) мгновенно отражаются.

### Realtime
- Включить публикацию для `cabinet_daily_insights` (`alter publication supabase_realtime add table`).
- Карточка автоматически обновится при оплате лида в CRM, без F5.

## Привязка лида к кабинету при создании

1. **`lead-intake` (edge function)** — уже принимает `cabinet_id` и `ad_account_id`. Доработать: сохранять `cabinet_id` в самой записи `leads` (сейчас только определяет `project_id`).
2. **Ручное добавление лида в CRM** — в форме создания лида добавить селект «Кабинет (источник)» со списком кабинетов проекта. Не обязательное поле.
3. **Карточка лида** — показывать привязанный кабинет, можно сменить вручную (для исправления старых лидов).

## Cron / автообновление

Добавить вызов `meta-daily-sync` в `pg_cron` раз в час за «вчера+сегодня» (если ещё нет). CRM-цифры обновляются триггерами мгновенно — крон для них не нужен.

## Файлы

**Миграции:**
- `add_cabinet_id_to_leads.sql` — колонка + индекс + бэкфилл по `utm`
- `cabinet_daily_insights_crm_fields.sql` — колонки + уникальный индекс `(cabinet_id, date)`
- `pipeline_stages_is_diagnostic.sql`
- `cabinet_attribution_triggers.sql` — триггеры на `lead_status_history` и `deals`
- `backfill_cabinet_crm.sql` — единоразовый пересчёт
- `realtime_publication.sql` — добавить таблицу в публикацию

**Edge functions:**
- `lead-intake/index.ts` — сохранять `cabinet_id` в `leads`

**Frontend:**
- `src/types/ads.ts` — поля `diagnostics, sales, crmRevenue, manualDiagnostics`
- `src/hooks/useMetaInsights.ts` → расширить (CRM-поля + realtime)
- `src/components/ads/CabinetRow.tsx` — новые метрики, новые столбцы, popover «добавить диагностику вручную»
- `src/pages/Settings.tsx` (вкладка «Воронки») — чекбокс «Этап диагностики» у стадий
- Карточка/форма лида (`src/pages/Leads.tsx` + редактор) — селект «Кабинет»

## Поведение, которое получит пользователь

1. Лид с сайта приходит → `lead-intake` пишет `cabinet_id` → в строке `cabinet_daily_insights` за сегодня лид уже есть (через Meta sync).
2. Менеджер в CRM перетаскивает лид в стадию «Диагностика» → триггер +1 к `crm_diagnostics` за дату перетаскивания → realtime обновляет карточку кабинета мгновенно.
3. Сделка оплачена → триггер +1 к `crm_sales`, +amount к `crm_revenue` за дату оплаты → карточка кабинета подсвечивает выручку CRM.
4. Если данных в CRM нет (например, диагностика проведена офлайн) — менеджер кликает на ячейку «Диагн.» в дневной таблице кабинета и руками ставит цифру. Сохраняется в `manual_diagnostics`.
5. Вчерашние/сегодняшние данные считаются автоматически по дням.
