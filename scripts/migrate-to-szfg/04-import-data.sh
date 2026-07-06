#!/usr/bin/env bash
# Импорт данных в szfgdruhlebfvcmlvxdk (после db push)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="/opt/homebrew/opt/libpq/bin:${PATH:-}"

TARGET_REF="${TARGET_REF:-szfgdruhlebfvcmlvxdk}"
DUMP_DIR="${1:?usage: ./04-import-data.sh ./tmp/lovable-dump/manual}"

: "${SUPABASE_DB_PASSWORD:?export SUPABASE_DB_PASSWORD=...}"

# Починить INSERT-ы под схему szfg
python3 "$ROOT/scripts/migrate-to-szfg/03b-fix-import-sql.py" "$DUMP_DIR"

# Прямой db.* хост часто недоступен с локальной машины — pooler надёжнее
POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-1-ap-northeast-1.pooler.supabase.com}"
CONN="postgresql://postgres.${TARGET_REF}:${SUPABASE_DB_PASSWORD}@${POOLER_HOST}:5432/postgres"

# Порядок важен из‑за foreign keys
ORDER=(
  projects
  project_members
  user_active_project
  pipelines
  pipeline_stages
  loss_reasons
  ad_cabinets
  automation_settings
  fx_rates
  cabinet_daily_insights
  meta_campaigns
  meta_campaign_daily
  meta_creatives
  meta_creative_daily
  leads
  lead_status_history
  communications
  tasks
  deals
  events
  rnp_daily
  instagram_accounts
  instagram_codewords
  instagram_organic_events
  instagram_media
  instagram_daily
  instagram_demographics
  phone_attribution
  capi_outbox
  project_briefs
  finance_plans
  report_subscriptions
  quick_replies
)

echo "Import → $TARGET_REF"

psql "$CONN" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/migrate-to-szfg/04a-pre-import-cleanup.sql"
psql "$CONN" -v ON_ERROR_STOP=0 -f "$ROOT/scripts/migrate-to-szfg/04c-supplement-ask-med.sql"

psql "$CONN" -v ON_ERROR_STOP=1 <<'SQL'
-- На время импорта отключаем триггеры, которые дублируют CDI
SET session_replication_role = replica;
SQL

IMPORTED_ANY=0
for t in "${ORDER[@]}"; do
  f="${DUMP_DIR}/${t}.sql"
  if [[ -f "$f" && -s "$f" ]]; then
    echo "  → $t"
    psql "$CONN" -v ON_ERROR_STOP=0 -f "$f" || echo "    warning: $t had errors (часто дубликаты — ок)"
    IMPORTED_ANY=1
  fi
done

# all.sql — только если нет разбивки по таблицам (иначе дубликаты)
if [[ "$IMPORTED_ANY" -eq 0 && -f "${DUMP_DIR}/all.sql" && -s "${DUMP_DIR}/all.sql" ]]; then
  echo "  → all.sql (bulk)"
  psql "$CONN" -v ON_ERROR_STOP=0 -f "${DUMP_DIR}/all.sql" || echo "    warning: all.sql had errors"
fi

psql "$CONN" -c "SET session_replication_role = DEFAULT;"

echo ""
echo "Проверка:"
psql "$CONN" -c "SELECT name FROM projects ORDER BY name;"
psql "$CONN" -c "SELECT COUNT(*) AS leads FROM leads;"
psql "$CONN" -c "SELECT COUNT(*) AS cdi FROM cabinet_daily_insights;"
