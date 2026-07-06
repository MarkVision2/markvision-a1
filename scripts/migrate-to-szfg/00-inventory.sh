#!/usr/bin/env bash
# Проверка: что уже есть на целевом Supabase szfgdruhlebfvcmlvxdk
set -euo pipefail

TARGET_REF="${TARGET_REF:-szfgdruhlebfvcmlvxdk}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env}"

if [[ -f "$ENV_FILE" ]]; then
  KEY=$(grep '^VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
  BASE=$(grep '^VITE_CLIENT_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
fi
KEY="${KEY:-}"
BASE="${BASE:-https://${TARGET_REF}.supabase.co}"

BASE="${BASE%/}"

if [[ -z "$KEY" ]]; then
  echo "Нет VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY в .env"
  exit 1
fi

echo "Target: $BASE"
echo ""

TABLES=(
  projects leads pipelines pipeline_stages ad_cabinets cabinet_daily_insights
  meta_creatives meta_creative_daily meta_campaigns meta_campaign_daily
  automation_settings profiles user_roles project_members
  content_factory_results content_factory_gallery content_projects
  rnp_daily deals events
)

for t in "${TABLES[@]}"; do
  resp=$(curl -s "$BASE/rest/v1/$t?select=id&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" || true)
  if echo "$resp" | grep -q '"code"'; then
    code=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code','?'))" 2>/dev/null || echo ERR)
    echo "  $t  →  нет / другая схема ($code)"
  else
    cnt=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo "?")
    echo "  $t  →  OK (sample rows: $cnt)"
  fi
done

echo ""
echo "Источник (Lovable): mekwfbqmsqiborjdrjxc — данные оттуда через pg_dump (см. 03-export-lovable.sh)"
