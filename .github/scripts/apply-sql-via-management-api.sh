#!/usr/bin/env bash
# Apply a SQL file to the linked Supabase project via Management API.
# Requires: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SQL_FILE
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?}"
: "${SUPABASE_PROJECT_REF:?}"
: "${SQL_FILE:?}"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "SQL file not found: $SQL_FILE" >&2
  exit 1
fi

# Management API expects JSON { "query": "..." }
python3 - <<'PY'
import json, os, urllib.request, sys
token = os.environ["SUPABASE_ACCESS_TOKEN"]
ref = os.environ["SUPABASE_PROJECT_REF"]
path = os.environ["SQL_FILE"]
query = open(path, encoding="utf-8").read()
body = json.dumps({"query": query}).encode("utf-8")
req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/database/query",
    data=body,
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        print(raw[:2000])
        print(f"OK status={resp.status}")
except urllib.error.HTTPError as e:
    err = e.read().decode("utf-8", errors="replace")
    print(f"HTTP {e.code}: {err}", file=sys.stderr)
    sys.exit(1)
PY
