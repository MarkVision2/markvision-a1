#!/usr/bin/env bash
# Экспорт Lovable через REST API (без пароля БД)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${LOVABLE_SERVICE_ROLE_KEY:-}" && -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  # подхватить из .env если есть
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    set -a
    # только если явно задан service role для lovable
    val=$(grep -E '^LOVABLE_SERVICE_ROLE_KEY=|^SUPABASE_SERVICE_ROLE_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)
    set +a
    if [[ -n "$val" ]]; then
      export LOVABLE_SERVICE_ROLE_KEY="$val"
    fi
  fi
fi

node scripts/migrate-to-szfg/03-export-lovable-rest.mjs
