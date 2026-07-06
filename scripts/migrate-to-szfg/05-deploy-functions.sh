#!/usr/bin/env bash
set -euo pipefail

TARGET_REF="${TARGET_REF:-szfgdruhlebfvcmlvxdk}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

: "${SUPABASE_ACCESS_TOKEN:=}"

cd "$ROOT"

if [[ -z "$SUPABASE_ACCESS_TOKEN" ]]; then
  if ! supabase projects list 2>/dev/null | grep -q "$TARGET_REF"; then
    echo "Нужен export SUPABASE_ACCESS_TOKEN=sbp_... или supabase login"
    exit 1
  fi
else
  export SUPABASE_ACCESS_TOKEN
fi

PRIORITY=(
  lead-intake
  meta-daily-sync
  meta-structure-sync
  meta-creative-refresh
  meta-creative-upsert
  meta-poster-upload
  capi-outbox-worker
  greenapi-webhook
  crm-stage-capi
  content-factory-proxy
  content-factory-cleanup
)

for fn in "${PRIORITY[@]}"; do
  if [[ -d "supabase/functions/$fn" ]]; then
    echo "→ deploy $fn"
    supabase functions deploy "$fn" --project-ref "$TARGET_REF"
  fi
done

echo ""
echo "Secrets (Dashboard → Edge Functions → каждая функция):"
echo "  META_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY"
echo "  CLIENT_SUPABASE_URL=https://${TARGET_REF}.supabase.co  (после объединения — тот же проект)"
echo "  GREENAPI_*, SIPUNI_*, LOVABLE_API_KEY — скопировать с Lovable"
