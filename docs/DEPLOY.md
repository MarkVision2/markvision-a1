# Production deploy

## Supabase — один проект `szfgdruhlebfvcmlvxdk`

| Ref | Роль |
|-----|------|
| **`szfgdruhlebfvcmlvxdk`** | **Единственный прод** — CRM, метрики, Meta, контент-завод, edge functions |
| `mekwfbqmsqiborjdrjxc` | Legacy Lovable — только бэкап до завершения миграции |

Миграция с Lovable: **`scripts/migrate-to-szfg/README.md`**

### Env (приложение)

Один проект на всё — **одинаковые** URL и anon key:

```env
VITE_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_SUPABASE_PROJECT_ID=szfgdruhlebfvcmlvxdk
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-

VITE_CLIENT_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-
```

Lovable: **Settings → Environment** — вставить блок выше, сохранить, дождаться rebuild.

До cutover в `.env` может оставаться Lovable — см. чеклист миграции.

### Миграции контент-завода (уже на szfg)

SQL из `supabase/migrations_client_config/` (если ещё не применяли):

- `006_content_factory_results.sql`
- `007_content_factory_gallery_brand.sql`
- `009_content_factory_cleanup.sql`
- `010_results_project_id.sql`

`project_id` в `content_factory_*` — UUID проекта MarkVision из приложения.

### Автоочистка старого контента (еженедельно)

| Что | По умолчанию | Где |
|-----|--------------|-----|
| `content_factory_gallery` | старше **30** дней | szfg DB |
| `content_factory_results` | старше **14** дней | szfg DB |
| `content-factory-uploads/requests/` | старше **14** дней | szfg Storage |

**Edge function** `content-factory-cleanup` деплоится на **szfg** (`supabase-deploy.yml`).

Secrets (Dashboard → Edge Functions → content-factory-cleanup, проект **szfg**):

| Secret | Значение |
|--------|----------|
| `CONTENT_FACTORY_CLEANUP_KEY` | случайная длинная строка |
| `CLIENT_SUPABASE_URL` | `https://szfgdruhlebfvcmlvxdk.supabase.co` (или тот же `SUPABASE_URL`) |
| `CLIENT_SUPABASE_SERVICE_ROLE_KEY` | service role **szfg** |

```bash
curl -X POST "https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/content-factory-cleanup" \
  -H "Content-Type: application/json" \
  -H "x-cleanup-key: YOUR_KEY" \
  -d '{"gallery_days":30,"results_days":14,"uploads_days":14}'
```

Только SQL: `SELECT public.cleanup_content_factory_data(30, 14);`

## Frontend (Lovable / Vercel)

`main` is the release branch. After push, open the Lovable project → **Share → Publish** (or confirm GitHub auto-sync is enabled).

### Как фронт попадает на Vercel — два пути

1. **Git-интеграция Vercel.** Собирает только коммиты, в сообщении которых есть метка
   `[vercel-deploy]` (`ignoreCommand` в `vercel.json` — защита квоты Hobby, 100 сборок в сутки).
   Поэтому PR в `main` мержим **merge-коммитом** с меткой в заголовке:
   `[vercel-deploy] Merge: … (#N)`. Squash без метки → Vercel сборку пропустит.
2. **Workflow `deploy-frontend-vercel.yml`** — Vercel CLI по секретам `VERCEL_TOKEN`,
   `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Если CLI не отработал, а метка в коммите есть,
   шаг завершается успехом (сборку сделает путь 1); если нет ни того, ни другого — падает.

### Если фронт не выкатился

- Лог workflow: `The token provided via --token argument is not valid` → перевыпустить токен
  (Vercel → Account Settings → Tokens) и обновить `VERCEL_TOKEN` в GitHub → Settings →
  Secrets → Actions.
- Ошибка «Фронт не выкатился ни одним путём» → в `main` попал коммит без метки. Быстрый
  повтор: `bash scripts/retry-vercel-deploy.sh` (пинг `public/.vercel-deploy-ping` с меткой)
  либо PR с таким пингом и merge-коммитом `[vercel-deploy] Merge: …`.
- Проверка: в PR комментарий `vercel[bot]` со статусом Ready, у коммита статус «Vercel —
  Deployment has completed».

## Supabase (migrations + edge functions)

GitHub Actions workflow: `.github/workflows/supabase-deploy.yml` (runs on `main` when `supabase/**` changes, or **workflow_dispatch**).

### Required repository secrets

| Secret | Where to get it |
|--------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | [Supabase Account → Access Tokens](https://supabase.com/dashboard/account/tokens) — доступ к **szfgdruhlebfvcmlvxdk** |
| `SUPABASE_DB_PASSWORD` | Supabase Dashboard → **Settings → Database** для **szfgdruhlebfvcmlvxdk** |
| `SUPABASE_PROJECT_REF` | Optional; defaults to `szfgdruhlebfvcmlvxdk` from `supabase/config.toml` |

Add secrets: GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.

### Manual CLI (if Actions secrets are not set)

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
export SUPABASE_DB_PASSWORD="..."   # password for szfgdruhlebfvcmlvxdk
supabase link --project-ref szfgdruhlebfvcmlvxdk --password "$SUPABASE_DB_PASSWORD"
supabase db push --password "$SUPABASE_DB_PASSWORD"
```

### Metrics hotfix migration only

Run SQL from `supabase/migrations/20260603120000_cdi_manual_override_nullable.sql` in SQL Editor **szfgdruhlebfvcmlvxdk** (после db push).
