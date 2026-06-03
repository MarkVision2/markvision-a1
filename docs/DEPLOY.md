# Production deploy

## Frontend (Lovable)

`main` is the release branch. After push, open the Lovable project → **Share → Publish** (or confirm GitHub auto-sync is enabled).

## Supabase (migrations + edge functions)

GitHub Actions workflow: `.github/workflows/supabase-deploy.yml` (runs on `main` when `supabase/**` changes, or **workflow_dispatch**).

### Required repository secrets

| Secret | Where to get it |
|--------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | [Supabase Account → Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_DB_PASSWORD` | Project → **Settings → Database** → database password |
| `SUPABASE_PROJECT_REF` | Optional; defaults to `mekwfbqmsqiborjdrjxc` from `supabase/config.toml` |

Add secrets: GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.

### Manual CLI (if Actions secrets are not set)

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
export SUPABASE_DB_PASSWORD="..."
supabase link --project-ref mekwfbqmsqiborjdrjxc --password "$SUPABASE_DB_PASSWORD"
supabase db push --password "$SUPABASE_DB_PASSWORD"
# deploy each function under supabase/functions/ (except _helpers)
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [[ "$name" == _* ]] && continue
  supabase functions deploy "$name" --project-ref mekwfbqmsqiborjdrjxc
done
```

### Metrics hotfix migration only

If you only need manual override semantics (`NULL` = CRM, `0` = explicit zero), run SQL from:

`supabase/migrations/20260603120000_cdi_manual_override_nullable.sql`

in Supabase Dashboard → **SQL Editor**.
