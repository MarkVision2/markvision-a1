#!/usr/bin/env bash
# CLI production deploy for www.markvision.kz (Hobby: avoid Git auto-deploys).
set -euo pipefail
: "${VERCEL_TOKEN:?}"
: "${VERCEL_ORG_ID:?}"
: "${VERCEL_PROJECT_ID:?}"
npx vercel@latest pull --yes --environment=production --token "$VERCEL_TOKEN"
python3 - <<'PY'
import json
from pathlib import Path
p = Path(".vercel/project.json")
d = json.loads(p.read_text())
d.setdefault("settings", {})["nodeVersion"] = "22.x"
p.write_text(json.dumps(d, indent=2) + "\n")
print("nodeVersion=", d["settings"]["nodeVersion"])
PY
npx vercel@latest build --prod --token "$VERCEL_TOKEN"
npx vercel@latest deploy --prebuilt --prod --token "$VERCEL_TOKEN"
