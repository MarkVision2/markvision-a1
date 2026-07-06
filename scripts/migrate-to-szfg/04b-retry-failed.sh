#!/usr/bin/env bash
# Повторный импорт только проблемных таблиц (после первого прогона)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="/opt/homebrew/opt/libpq/bin:${PATH:-}"

TARGET_REF="${TARGET_REF:-szfgdruhlebfvcmlvxdk}"
DUMP_DIR="${1:-$ROOT/tmp/lovable-dump/manual}"

: "${SUPABASE_DB_PASSWORD:?export SUPABASE_DB_PASSWORD=...}"

POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-1-ap-northeast-1.pooler.supabase.com}"
CONN="postgresql://postgres.${TARGET_REF}:${SUPABASE_DB_PASSWORD}@${POOLER_HOST}:5432/postgres"

python3 "$ROOT/scripts/migrate-to-szfg/03b-fix-import-sql.py" "$DUMP_DIR"

TABLES=(
  pipelines pipeline_stages ad_cabinets automation_settings
  meta_campaigns meta_campaign_daily meta_creatives meta_creative_daily
  leads lead_status_history communications events phone_attribution
)

psql "$CONN" -f "$ROOT/scripts/migrate-to-szfg/04a-pre-import-cleanup.sql"
psql "$CONN" -v ON_ERROR_STOP=0 -f "$ROOT/scripts/migrate-to-szfg/04c-supplement-ask-med.sql"
psql "$CONN" -c "SET session_replication_role = replica;"

for t in "${TABLES[@]}"; do
  f="$DUMP_DIR/${t}.sql"
  if [[ -f "$f" && -s "$f" ]]; then
    echo "  → $t"
    psql "$CONN" -v ON_ERROR_STOP=0 -f "$f" || true
  fi
done

psql "$CONN" -c "SET session_replication_role = DEFAULT;"

echo ""
echo "Проверка:"
psql "$CONN" -c "SELECT name FROM projects ORDER BY name;"
psql "$CONN" -c "SELECT COUNT(*) AS leads FROM leads;"
psql "$CONN" -c "SELECT COUNT(*) AS cabinets FROM ad_cabinets;"
psql "$CONN" -c "SELECT COUNT(*) AS cdi FROM cabinet_daily_insights;"
