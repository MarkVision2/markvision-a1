#!/usr/bin/env bash
# Деплой Green API Edge Functions на прод (mekwfbqmsqiborjdrjxc).
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-mekwfbqmsqiborjdrjxc}"
FUNCS=(greenapi-webhook greenapi-proxy greenapi-setup)

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: export SUPABASE_ACCESS_TOKEN=<PAT from supabase.com/dashboard/account/tokens>"
  exit 1
fi

cd "$(dirname "$0")/.."
CLI=(npx supabase@latest)

echo "Project: $PROJECT_REF"
for fn in "${FUNCS[@]}"; do
  echo ":: Deploying $fn ..."
  "${CLI[@]}" functions deploy "$fn" --project-ref "$PROJECT_REF"
done

echo "Done. Apply migrations: npx supabase db push --project-ref $PROJECT_REF"
