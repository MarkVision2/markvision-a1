# Production deploy

## Два проекта Supabase (важно)

| Проект | Ref | Где используется |
|--------|-----|------------------|
| **Основной (Lovable / приложение)** | `mekwfbqmsqiborjdrjxc` | `VITE_SUPABASE_URL` — метрики, CRM, `cabinet_daily_insights` |
| **Clony / контент-завод** | `szfgdruhlebfvcmlvxdk` | `VITE_CLIENT_SUPABASE_URL` — uploads, results, **галерея**, шаблоны бренда |

Миграции метрик и SQL для `cabinet_daily_insights` выполняйте **только** в **`mekwfbqmsqiborjdrjxc`**.

В `szfgdruhlebfvcmlvxdk` нет таблицы `projects` и CRM-таблиц — ошибка `relation "public.projects" does not exist` значит, что SQL для MarkVision запустили в Clony.

### Миграции контент-завода (Clony)

В SQL Editor проекта **szfgdruhlebfvcmlvxdk** по порядку из `supabase/migrations_client_config/`:

- `006_content_factory_results.sql` — результаты n8n (если ещё нет)
- `007_content_factory_gallery_brand.sql` — галерея «Готовый контент» + шаблоны бренда + storage buckets
- `009_content_factory_cleanup.sql` — RPC `cleanup_content_factory_data` + журнал `content_factory_cleanup_log`
- `010_results_project_id.sql` — `project_id` в `content_factory_results` (галерея грузит все креативы проекта)

`project_id` в этих таблицах — UUID проекта MarkVision (из приложения), **без FK** на `projects`.

### Автоочистка старого контента (еженедельно)

Чтобы не упираться в лимиты Clony, раз в неделю удаляются:

| Что | По умолчанию | Где |
|-----|--------------|-----|
| `content_factory_gallery` | старше **30** дней | Clony DB |
| `content_factory_results` | старше **14** дней | Clony DB |
| `content-factory-uploads/requests/` | старше **14** дней | Clony Storage |

Шаблоны бренда (`content-factory/brand/`) **не трогаем** — они привязаны к активным шаблонам.

**1. Миграция в Clony:** выполните `009_content_factory_cleanup.sql` в SQL Editor **szfgdruhlebfvcmlvxdk**.

**2. Edge function** `content-factory-cleanup` деплоится на **MarkVision** (`mekwfbqmsqiborjdrjxc`) вместе с остальными functions (`supabase-deploy.yml`).

**3. Secrets edge function** (Dashboard → Edge Functions → content-factory-cleanup → Secrets, проект **mekwfbqmsqiborjdrjxc**):

| Secret | Значение |
|--------|----------|
| `CONTENT_FACTORY_CLEANUP_KEY` | случайная длинная строка (shared secret для cron) |
| `CLIENT_SUPABASE_URL` | `https://szfgdruhlebfvcmlvxdk.supabase.co` |
| `CLIENT_SUPABASE_SERVICE_ROLE_KEY` | service role key проекта **Clony** |

**4. GitHub secret** для cron: `CONTENT_FACTORY_CLEANUP_KEY` — **тот же** ключ, что в п.3.

Workflow: `.github/workflows/content-factory-cleanup.yml` — воскресенье **03:00 UTC**, или **Run workflow** вручную.

Ручной запуск без GitHub:

```bash
curl -X POST "https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/content-factory-cleanup" \
  -H "Content-Type: application/json" \
  -H "x-cleanup-key: YOUR_KEY" \
  -d '{"gallery_days":30,"results_days":14,"uploads_days":14}'
```

Только SQL (без storage): в Clony SQL Editor — `SELECT public.cleanup_content_factory_data(30, 14);`

Журнал прогонов: `SELECT * FROM content_factory_cleanup_log ORDER BY ran_at DESC LIMIT 20;`

Personal Access Token из Supabase Dashboard часто привязан **только** к client-проекту и **не** даёт доступ к Lovable-проекту `mekwfbqmsqiborjdrjxc`. Пароль БД и SQL Editor для основного проекта — в **Lovable → Project Settings → Supabase**.

## Frontend (Lovable)

`main` is the release branch. After push, open the Lovable project → **Share → Publish** (or confirm GitHub auto-sync is enabled).

## Supabase (migrations + edge functions)

GitHub Actions workflow: `.github/workflows/supabase-deploy.yml` (runs on `main` when `supabase/**` changes, or **workflow_dispatch**).

### Required repository secrets

| Secret | Where to get it |
|--------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | [Supabase Account → Access Tokens](https://supabase.com/dashboard/account/tokens) — must have access to **mekwfbqmsqiborjdrjxc** for app deploy |
| `SUPABASE_DB_PASSWORD` | **Lovable** or Supabase → **Settings → Database** for project **mekwfbqmsqiborjdrjxc** |
| `SUPABASE_PROJECT_REF` | Optional; defaults to `mekwfbqmsqiborjdrjxc` from `supabase/config.toml` |

Add secrets: GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.

### Manual CLI (if Actions secrets are not set)

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
export SUPABASE_DB_PASSWORD="..."   # password for mekwfbqmsqiborjdrjxc
supabase link --project-ref mekwfbqmsqiborjdrjxc --password "$SUPABASE_DB_PASSWORD"
supabase db push --password "$SUPABASE_DB_PASSWORD"
```

### Metrics hotfix migration only

Run SQL from `supabase/migrations/20260603120000_cdi_manual_override_nullable.sql` in SQL Editor проекта **mekwfbqmsqiborjdrjxc** (не szfgdruhlebfvcmlvxdk).
