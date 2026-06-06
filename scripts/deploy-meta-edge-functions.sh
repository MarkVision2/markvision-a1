#!/usr/bin/env bash
# Деплой трёх Meta Edge Functions на прод (mekwfbqmsqiborjdrjxc).
# Требует: SUPABASE_ACCESS_TOKEN (PAT с правами на проект) и доступ к org.
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-mekwfbqmsqiborjdrjxc}"
FUNCS=(content-factory-proxy content-factory-cleanup greenapi-setup meta-list-ad-accounts meta-daily-sync meta-validate-cabinet)

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: export SUPABASE_ACCESS_TOKEN=<Personal Access Token from supabase.com/dashboard/account/tokens>"
  exit 1
fi

cd "$(dirname "$0")/.."
CLI=(npx supabase@latest)

echo "Project: $PROJECT_REF"
for fn in "${FUNCS[@]}"; do
  echo ":: Deploying $fn ..."
  "${CLI[@]}" functions deploy "$fn" --project-ref "$PROJECT_REF"
done

echo "Done. Verify in Dashboard → Edge Functions."
