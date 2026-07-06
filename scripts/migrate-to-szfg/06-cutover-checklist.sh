#!/usr/bin/env bash
# После импорта данных — что поменять в коде и инфраструктуре
set -euo pipefail

TARGET_REF="szfgdruhlebfvcmlvxdk"
TARGET_URL="https://${TARGET_REF}.supabase.co"

cat <<EOF
=== CUT OVER CHECKLIST ===

1. .env (локально + Vercel + Lovable env):
   VITE_SUPABASE_URL=${TARGET_URL}
   VITE_SUPABASE_PROJECT_ID=${TARGET_REF}
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon из Dashboard ${TARGET_REF}>

   # Один проект на всё (рекомендуется):
   VITE_CLIENT_SUPABASE_URL=${TARGET_URL}
   VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=<тот же anon>

2. Репозиторий:
   supabase/config.toml  → project_id = "${TARGET_REF}"
   index.html preconnect → ${TARGET_URL}
   GitHub Secrets:
     SUPABASE_PROJECT_REF=${TARGET_REF}
     SUPABASE_DB_PASSWORD=<новый>
     SUPABASE_ACCESS_TOKEN=<ваш sbp_>

3. n8n / webhooks — заменить хост:
   mekwfbqmsqiborjdrjxc.supabase.co → ${TARGET_REF}.supabase.co
   (meta-creative-upsert, lead-intake, greenapi, …)

4. SQL cron jobs — если в миграциях остались URL Lovable:
   grep -r mekwfbqmsqiborjdrjxc supabase/migrations/

5. Storage: скопировать bucket creative-posters с Lovable (если есть постеры)

6. Auth: пользователи должны существовать в ${TARGET_REF}
   (invite заново или импорт auth.users)

7. Проверка:
   - Логин в приложение
   - Дашборд / Метрики / CRM / Креативы
   - Контент-завод (content_factory_results)

8. Lovable проект можно оставить read-only как бэкап 2 недели

EOF

grep -rl "mekwfbqmsqiborjdrjxc" "$(dirname "$0")/../.." \
  --include='*.ts' --include='*.tsx' --include='*.sql' --include='*.yml' --include='*.toml' --include='*.html' 2>/dev/null \
  | grep -v node_modules | grep -v migrate-to-szfg || true
