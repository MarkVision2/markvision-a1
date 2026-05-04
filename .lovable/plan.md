
## Что мы делаем

Связываем 4 потока данных с Supabase так, чтобы всё было привязано к проекту (`project_id`) и отображалось на сайте:

1. **Кабинеты (clientConfig)** — форма «Добавить кабинет» сохраняет всё в `ad_cabinets` (это и есть наш «client config»).
2. **Кампании** — кнопка «Создать кампанию» сохраняет в `ad_campaigns` И отправляет в n8n; n8n через edge-функцию `cabinet-config` вытаскивает все данные кабинета по `ad_account_id` / `cabinet_id` / `project_id`.
3. **Лиды CRM** — лиды падают в `leads` (через `lead-intake` webhook), привязка к проекту, отображаются на странице CRM.
4. **Daily data Meta** — `cabinet_daily_insights` ежедневно наполняется через `meta-daily-sync`, отображается на странице рекламы по выбранному месяцу с фильтром по проекту.

---

## Текущее состояние (что уже есть)

- ✅ Таблица `ad_cabinets` (есть `project_id`, но **не заполняется** при создании)
- ✅ Таблица `ad_campaigns` (нет `project_id`)
- ✅ Таблица `cabinet_daily_insights` (нет `project_id` — приходит через `cabinet_id`)
- ✅ Таблица `leads` (нет `project_id`)
- ✅ Edge-функции: `cabinet-config`, `meta-daily-sync`, `lead-intake`
- ✅ Все секреты заполнены (META_ACCESS_TOKEN, GREENAPI_*)
- ❌ Нет привязки к `project_id` нигде → все пользователи видят все данные одной кучей
- ❌ В UI Ads дневные/месячные цифры в `CabinetRow` не подтягиваются из `cabinet_daily_insights`
- ❌ Нет cron-расписания для `meta-daily-sync`

---

## План изменений

### 1. Схема БД — добавить `project_id` везде

Миграция:
- `ad_campaigns` → добавить `project_id uuid` (nullable)
- `cabinet_daily_insights` → добавить `project_id uuid` (nullable, заполняется автоматом из cabinet)
- `leads` → добавить `project_id uuid` (nullable)
- Индексы: `(project_id, date)`, `(project_id, created_at)`
- RLS остаются как есть (доступ для authenticated), но добавим фильтрацию по project_id в клиентских запросах

### 2. Сохранение `project_id` при создании

- **`AddCabinetDialog`** → `useCabinetsStore.addCabinet`: брать `activeId` из `useProjectsStore` и писать в `project_id`.
- **`CreateCampaignDialog`** → `saveCampaign`: писать `project_id` активного проекта.
- **`lead-intake` edge**: принимать `project_id` (или `cabinet_id` → определять project_id) и проставлять в `leads`.
- **`meta-daily-sync` edge**: при upsert в `cabinet_daily_insights` подтягивать `project_id` из `ad_cabinets` и писать.

### 3. Чтение по активному проекту

- `useCabinetsStore` → фильтровать `.eq('project_id', activeId)` (с fallback на legacy без project_id).
- `useCrmStore` (страница CRM) → фильтр `project_id`.
- Дашборд / отчёты → фильтр `project_id`.

### 4. Отображение Meta-статистики на странице Ads

- Создать хук `useCabinetDailyInsights(monthCursor, projectId)` — запрашивает `cabinet_daily_insights` за выбранный месяц.
- В `CabinetRow` показывать суммы за месяц (spend, leads, CPL, clicks, revenue) из реальных данных вместо моков из `ad_cabinets.spend/leads/...`.
- Кнопка «Обновить» вызывает `meta-daily-sync` за сегодня + рефетч.

### 5. Автоматический ежедневный sync

- Включить расширения `pg_cron` и `pg_net`.
- Создать cron job: каждый день в 03:00 UTC дёргать `meta-daily-sync` (за вчера) — через `net.http_post` с anon-ключом.

### 6. n8n флоу запуска кампании

Уже работает: `CreateCampaignDialog` шлёт payload с `clientConfig` в n8n webhook. Дополнительно n8n может звать `cabinet-config?cabinet_id=...` чтобы получить полный конфиг с сервера (надёжнее, чем client payload). В payload добавим `cabinet_id` и `project_id` для удобства n8n.

---

## Технические детали

### Миграция SQL (схема)

```sql
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE cabinet_daily_insights ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_id uuid;

CREATE INDEX IF NOT EXISTS idx_cdi_project_date ON cabinet_daily_insights (project_id, date);
CREATE INDEX IF NOT EXISTS idx_leads_project ON leads (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_project ON ad_campaigns (project_id, created_at DESC);
```

### Cron (через insert tool, не миграцию)

```sql
SELECT cron.schedule(
  'meta-daily-sync-3am',
  '0 3 * * *',
  $$ SELECT net.http_post(
    url := 'https://zaxpweutxzepxzzduvpm.supabase.co/functions/v1/meta-daily-sync',
    headers := '{"Content-Type":"application/json","apikey":"<ANON>"}'::jsonb,
    body := '{}'::jsonb
  ); $$
);
```

### Файлы, которые меняем

- `src/hooks/useCabinetsStore.ts` — фильтр + запись `project_id`
- `src/hooks/useCrmStore.ts` — фильтр `project_id` при чтении лидов
- `src/components/ads/CabinetRow.tsx` — подключить хук дневных метрик
- `src/hooks/useCabinetDailyInsights.ts` — НОВЫЙ хук
- `src/components/ads/CreateCampaignDialog.tsx` — добавить `cabinet_id`/`project_id` в payload n8n
- `supabase/functions/meta-daily-sync/index.ts` — писать `project_id`
- `supabase/functions/lead-intake/index.ts` — принимать/проставлять `project_id`

### Что НЕ ломаем
- Старые записи без `project_id` остаются видимыми (фильтр учитывает `OR project_id IS NULL` для legacy).
- RLS-политики не меняем — только чтение фильтруется на клиенте.

---

## Результат

После применения:
- Каждый кабинет/кампания/лид/дневная статистика жёстко привязаны к проекту.
- Переключение проекта в `ProjectSwitcher` показывает только данные этого проекта.
- На странице Ads в строке кабинета видны реальные расходы/лиды/CPL за выбранный месяц из Meta.
- Cron каждое утро автоматом подтягивает вчерашние данные по всем кабинетам.
- n8n получает полный конфиг кабинета по `cabinet_id` и запускает рекламу.
