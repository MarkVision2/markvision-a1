# Миграция MarkVision → `szfgdruhlebfvcmlvxdk`

**Цель:** одна Supabase на всё — CRM, метрики, Meta, контент-завод, edge functions.

| Было | Станет |
|------|--------|
| `mekwfbqmsqiborjdrjxc` (Lovable) — приложение | read-only бэкап |
| `szfgdruhlebfvcmlvxdk` — только контент-завод | **единственный прод** |

## Порядок (строго по шагам)

### 0. Секреты (один раз)

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."      # доступ к szfgdruhlebfvcmlvxdk
export SUPABASE_DB_PASSWORD="..."           # Dashboard → Database → szfg
export LOVABLE_DB_PASSWORD="..."            # Lovable → Supabase → Database password
```

### 1. Подготовить szfg (SQL Editor)

Файл: **`01-prepare-target.sql`**

Переименует CF-таблицы `pipelines` / `pipeline_stages` / `leads`, чтобы `db push` не упёрся.

Ожидаемый результат последнего SELECT:
- `has_mv_projects` = false
- `has_pipeline_stages` = false (переименовано в `*_legacy_cf`)
- `has_content_factory` = true

### 2. Накатить схему MarkVision

```bash
./scripts/migrate-to-szfg/02-apply-schema.sh
```

~96 миграций из `supabase/migrations/`. После — в Table Editor должны появиться `projects`, `ad_cabinets`, `cabinet_daily_insights`, `leads`.

### 3. Выгрузить данные с Lovable (без пароля и без service role)

Lovable **не даёт** ни database password, ни service role. Используйте **SQL Editor** в Lovable:

1. Откройте **Lovable → Supabase → SQL Editor** (проект `mekwfbqmsqiborjdrjxc`)
2. Вставьте и запустите целиком: **`03-export-lovable-sql-editor.sql`**
3. В результате колонки `table_name` + `line` → **Export CSV** (кнопка в SQL Editor)
4. Локально (**из корня репозитория**, не из `~`):

```bash
cd "/путь/к/markvision-a1"
./scripts/migrate-to-szfg/03-split-lovable-csv.sh ~/Downloads/query-results-export-....csv
```

Supabase SQL Editor экспортирует CSV с разделителем `;` — скрипт это понимает.

**Альтернатива** (если есть service role JWT `eyJ...`):

```bash
export LOVABLE_SERVICE_ROLE_KEY="eyJ..."
./scripts/migrate-to-szfg/03-export-lovable-rest.sh
```

**Альтернатива** (если есть database password):

```bash
export LOVABLE_DB_PASSWORD="..."
./scripts/migrate-to-szfg/03-export-lovable.sh
```

Дамп → `tmp/lovable-dump/manual/`.

### 4. Импорт в szfg

```bash
export SUPABASE_DB_PASSWORD="..."
./scripts/migrate-to-szfg/04-import-data.sh ./tmp/lovable-dump/manual
```

Если часть таблиц упала (воронки, кабинеты, лиды) — повтор:

```bash
./scripts/migrate-to-szfg/04b-retry-failed.sh
```

Скрипты автоматически: чинят `days_of_week`, generated-колонки, добавляют «Аск Мед», убирают авто-воронки.

### 5. Edge functions + secrets

```bash
./scripts/migrate-to-szfg/05-deploy-functions.sh
```

Скопировать secrets с Lovable (META_ACCESS_TOKEN, GREENAPI_*, SIPUNI_*, …).

После объединения **`CLIENT_SUPABASE_URL` = `SUPABASE_URL`** (один проект).

### 6. Переключить приложение

```bash
./scripts/migrate-to-szfg/06-cutover-checklist.sh
```

В `.env` / Vercel / Lovable:

```env
VITE_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_SUPABASE_PROJECT_ID=szfgdruhlebfvcmlvxdk
VITE_SUPABASE_PUBLISHABLE_KEY=<anon szfg>

# Один проект — те же значения:
VITE_CLIENT_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=<тот же anon>
```

GitHub Secrets: `SUPABASE_PROJECT_REF=szfgdruhlebfvcmlvxdk`, новый `SUPABASE_DB_PASSWORD`.

### 7. Auth

Пользователи из Lovable **не переносятся автоматически**. Варианты:
- invite заново в szfg Dashboard → Authentication
- или `pg_dump --table=auth.users` (осторожно)

### 8. Проверка

- [ ] Логин
- [ ] Дашборд / Метрики (2 проекта, CDI)
- [ ] CRM / лиды
- [ ] Креативы Meta
- [ ] Контент-завод (607+ results)
- [ ] n8n webhooks → `szfgdruhlebfvcmlvxdk.supabase.co`

## Аудит данных

- `00-audit-counts-simple.sql` — на Lovable перед экспортом
- `00-inventory.sh` — REST-проверка szfg

## Что сохраняется на szfg

| Таблицы | Действие |
|---------|----------|
| `content_factory_*`, `content_projects` | **Не трогаем** |
| `clients_config`, `leads_crm`, `client_configs` | **Остаются** (n8n / WA) |
| `pipeline_stages_legacy_cf`, `pipelines_legacy_szfg` | Архив CF-воронки |

## Откат

Lovable `mekwfbqmsqiborjdrjxc` не удалять 2 недели. Откат = вернуть старые `VITE_SUPABASE_*` в env.
