# Production deploy

## Два проекта Supabase (важно)

| Проект | Ref | Где используется |
|--------|-----|------------------|
| **Основной (Lovable / приложение)** | `mekwfbqmsqiborjdrjxc` | `VITE_SUPABASE_URL` — метрики, CRM, `cabinet_daily_insights` |
| **Client (отдельный аккаунт)** | `szfgdruhlebfvcmlvxdk` | `VITE_CLIENT_SUPABASE_URL` — client_configs, часть Ads |

Миграции метрик и SQL для `cabinet_daily_insights` выполняйте **только** в **`mekwfbqmsqiborjdrjxc`**.

В `szfgdruhlebfvcmlvxdk` этой таблицы нет — ошибка `relation "public.cabinet_daily_insights" does not exist` ожидаема.

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
