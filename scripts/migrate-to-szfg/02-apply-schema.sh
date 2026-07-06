#!/usr/bin/env bash
# Накатить все миграции markvision-a1 на szfgdruhlebfvcmlvxdk
set -euo pipefail

TARGET_REF="${TARGET_REF:-szfgdruhlebfvcmlvxdk}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

: "${SUPABASE_DB_PASSWORD:?export SUPABASE_DB_PASSWORD=... из Dashboard → Database}"

# Access token (sbp_...) нужен только для deploy functions, не для db push
if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  export SUPABASE_ACCESS_TOKEN
fi

cd "$ROOT"

echo "→ Link $TARGET_REF"
supabase link --project-ref "$TARGET_REF" --password "$SUPABASE_DB_PASSWORD"

echo "→ db push"
supabase db push --password "$SUPABASE_DB_PASSWORD"

echo ""
echo "Готово. Проверьте в Dashboard → Table Editor: projects, ad_cabinets, cabinet_daily_insights"
echo "Дальше: 03-export-lovable.sh и 04-import-data.sh"
