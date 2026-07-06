#!/usr/bin/env bash
# Выгрузка ДАННЫХ из Lovable Supabase (mekwfbqmsqiborjdrjxc)
# Нужен database password: Lovable → Project Settings → Supabase → Database password
set -euo pipefail

SOURCE_REF="${SOURCE_REF:-mekwfbqmsqiborjdrjxc}"
OUT_DIR="${OUT_DIR:-./tmp/lovable-dump-$(date +%Y%m%d)}"

: "${LOVABLE_DB_PASSWORD:?export LOVABLE_DB_PASSWORD=...}"

HOST="db.${SOURCE_REF}.supabase.co"
CONN="postgresql://postgres:${LOVABLE_DB_PASSWORD}@${HOST}:5432/postgres"

mkdir -p "$OUT_DIR"

# Только данные, без DDL (схему уже накатили db push на szfg)
TABLES=(
  projects
  project_members
  user_active_project
  pipelines
  pipeline_stages
  loss_reasons
  ad_cabinets
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
  automation_settings
  fx_rates
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

echo "Export from $SOURCE_REF → $OUT_DIR"

for t in "${TABLES[@]}"; do
  echo "  $t"
  pg_dump "$CONN" \
    --data-only \
    --no-owner \
    --no-privileges \
    --table="public.${t}" \
    -f "${OUT_DIR}/${t}.sql" 2>/dev/null || echo "    (skip — таблица пустая или нет)"
done

# Auth users — отдельно (нужен service role / dashboard export)
echo ""
echo "⚠️  auth.users — экспортируйте через Supabase Dashboard → Authentication → Users"
echo "    или: pg_dump --table=auth.users (осторожно с паролями)"

# Storage buckets
echo ""
echo "Storage (вручную или supabase CLI):"
echo "  creative-posters, content-factory-uploads (если на Lovable)"
echo ""
echo "Дамп готов: $OUT_DIR"
echo "Импорт: ./04-import-data.sh $OUT_DIR"
