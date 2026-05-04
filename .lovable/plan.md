## Что я нашёл (важно прочитать)

1. **Проектов в БД нет ни одного.** Таблица `projects` пустая. То есть `useProjectsStore.activeId` всегда пуст, и привязки «по проекту» физически не существует — даже если код фильтрует по `project_id`, он фильтрует по `null`.
2. **Кабинет «KOST MARKETING»** (`act_394987113464047`) создан с `project_id = NULL`.
3. **Таблица `cabinet_daily_insights` пуста** — `meta-daily-sync` ни разу не отрабатывал по этому кабинету.
4. **Дашборд / Сквозная аналитика / Reports** сейчас НЕ читают `cabinet_daily_insights` (только `useMetaInsights` дёргает её разово). То есть даже если данные зальются — на дашборде они не появятся, пока не подключим источник.
5. Cron сейчас стоит на **03:00 UTC**, а пользователь просит **01:00**.

Поэтому одних «залить данные» недостаточно — нужно сначала навести порядок с проектом и подключить отображение.

---

## План

### Шаг 1. Создать проект «KOST MARKETING» и привязать к нему кабинет
- Вставить запись в `projects` (name = «KOST MARKETING», `is_primary = true`, `created_by` = текущий пользователь).
- Поставить его активным в `user_active_project` для пользователя.
- Сделать `UPDATE ad_cabinets SET project_id = <new_project_id> WHERE id = 'b4d60ec5...'`.

### Шаг 2. Бэкфилл Meta-статистики с 2026-05-01 по вчера
- Доработать `meta-daily-sync` так, чтобы принимал параметры `since` и `until` (диапазон дат) и `cabinet_id` (опционально — синк только по одному кабинету). Сейчас он умеет только одну дату.
- Внутри: для каждой даты диапазона делать запрос `time_increment=1` (Meta вернёт массив по дням за один вызов) и upsert по `(external_id, date)` с `project_id` из кабинета.
- Один раз вручную дёрнуть функцию: `since=2026-05-01`, `until=вчера`, `cabinet_id=b4d60ec5...`. Данные лягут в `cabinet_daily_insights` с `project_id` проекта.

### Шаг 3. Поправить cron на 01:00 (а не 03:00)
- `cron.unschedule('meta-daily-sync-3am')`.
- `cron.schedule('meta-daily-sync-1am', '0 1 * * *', …)` — каждый день в 01:00 UTC дёргать `meta-daily-sync` без параметров (= синк за вчера по всем кабинетам).
- Функция уже ставит `project_id` из кабинета, так что данные сразу разделены по проектам.

### Шаг 4. Подключить отображение Meta-данных по проекту
Сейчас Dashboard / Метрики / Analytics показывают моки или агрегаты не из `cabinet_daily_insights`. Делаю единый хук-источник и перевожу страницы на него:

- **Новый хук `useProjectDailyInsights(projectId, dateFrom, dateTo)`** — читает `cabinet_daily_insights` фильтром `project_id = activeId AND date BETWEEN …` и агрегирует: spend, leads, clicks, impressions, revenue, CPL, CPM, CPC, CTR.
- **`Dashboard.tsx`** — KPI-карточки (расход, лиды, CPL, выручка) + график «Расход/Выручка» питать из этого хука по выбранному периоду; фильтр по `activeId` из `useProjectsStore`.
- **`Metrics.tsx` (сквозная аналитика)** — таблица показателей по дням берёт строки `cabinet_daily_insights` за период и активный проект.
- **`Reports`/MarketingPage** — суммы за период из того же источника.
- **`CabinetRow.tsx`** на странице Ads — вместо моков из `ad_cabinets.spend/leads` показывать сумму за выбранный месяц из `cabinet_daily_insights` для этого `cabinet_id`. Кнопка «Обновить» вызывает `meta-daily-sync` за сегодня по этому кабинету и рефетчит.

### Шаг 5. Гарантировать, что новые кабинеты всегда привязываются к активному проекту
- В `AddCabinetDialog` / `useCabinetsStore.addCabinet` блокировать создание, если `activeId` пуст (показать тост «Сначала создайте проект»). Это уберёт повторение текущей ситуации.

---

## Технические детали

### SQL (через insert-tool, не миграция)
```sql
-- 1. Создать проект и привязать кабинет (ID пользователя возьму из auth.users по email)
WITH u AS (SELECT id FROM auth.users WHERE email = 'zapoinov@bk.ru' LIMIT 1),
     p AS (
       INSERT INTO projects (name, initials, is_primary, created_by)
       SELECT 'KOST MARKETING', 'KM', true, u.id FROM u
       RETURNING id
     )
INSERT INTO user_active_project (user_id, project_id)
SELECT u.id, p.id FROM u, p
ON CONFLICT (user_id) DO UPDATE SET project_id = EXCLUDED.project_id;

UPDATE ad_cabinets
SET project_id = (SELECT id FROM projects WHERE name = 'KOST MARKETING')
WHERE id = 'b4d60ec5-92e9-401e-95da-d7c3a1002321';
```

### Cron (через insert-tool)
```sql
SELECT cron.unschedule('meta-daily-sync-3am');
SELECT cron.schedule(
  'meta-daily-sync-1am',
  '0 1 * * *',
  $$ SELECT net.http_post(
    url := 'https://zaxpweutxzepxzzduvpm.supabase.co/functions/v1/meta-daily-sync',
    headers := '{"Content-Type":"application/json","apikey":"<ANON>"}'::jsonb,
    body := '{}'::jsonb
  ); $$
);
```

### Бэкфилл (один curl edge-функции после доработки)
```
POST /functions/v1/meta-daily-sync
{ "since": "2026-05-01", "until": "<вчера>", "cabinet_id": "b4d60ec5-92e9-401e-95da-d7c3a1002321" }
```

### Файлы
- `supabase/functions/meta-daily-sync/index.ts` — поддержка `since/until/cabinet_id`, time_increment по диапазону.
- `src/hooks/useProjectDailyInsights.ts` — НОВЫЙ.
- `src/hooks/useDashboardData.ts`, `src/pages/Dashboard.tsx` — источник = новый хук.
- `src/pages/Metrics.tsx` — таблица показателей из новых данных.
- `src/components/reports/MarketingPage.tsx` — суммы из новых данных.
- `src/components/ads/CabinetRow.tsx` — реальные цифры за месяц.
- `src/hooks/useCabinetsStore.ts` / `src/components/ads/AddCabinetDialog.tsx` — запрет создания кабинета без активного проекта.

### Что НЕ ломаем
- RLS не трогаем — все таблицы уже доступны authenticated.
- Старые поля `ad_cabinets.spend/leads/...` оставляем — они больше не источник правды, но не удаляем, чтобы не ломать формы.

---

## Результат
- Проект «KOST MARKETING» появляется в свитчере, кабинет привязан к нему.
- Meta-данные с 1 мая 2026 по вчера лежат в `cabinet_daily_insights` с правильным `project_id`.
- Каждую ночь в **01:00 UTC** cron автоматически тянет вчерашний день по всем кабинетам, раскладывая по проектам.
- На странице Ads, в Dashboard, в Метриках (сквозная аналитика) и в Reports видны реальные расходы/лиды/клики/CPL/CPM по активному проекту за выбранный период.
- Новые кабинеты нельзя создать без активного проекта — путаница «всё в одной куче» больше не повторится.