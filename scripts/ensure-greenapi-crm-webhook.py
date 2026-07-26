#!/usr/bin/env python3
"""Keep Green API webhook pointed at MarkVision CRM (greenapi-webhook).

n8n / console sometimes overwrite webhookUrl to the bot endpoint. CRM must own
the webhook and forwards a copy to whatsapp_config.bot_webhook_url.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
CRM_WEBHOOK = os.environ.get(
    "CRM_GREENAPI_WEBHOOK_URL",
    "https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/greenapi-webhook",
).rstrip("/")


def load_database_url() -> str:
    raw = ENV_PATH.read_text()
    m = re.search(r"^DATABASE_URL=(.*)$", raw, re.M)
    if not m:
        raise SystemExit("DATABASE_URL missing in .env")
    return m.group(1).strip().strip('"').strip("'")


def psql(url: str, sql: str) -> str:
    import subprocess

    r = subprocess.run(
        ["psql", url, "-At", "-F", "\t", "-c", sql],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "psql failed")
    return r.stdout.strip()


def http_json(method: str, url: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"} if body is not None else {},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def ensure_row(row: str) -> bool:
    idi, token, api_url, wh_token, bot_url, project = (row.split("\t") + [""] * 6)[:6]
    if not idi or not token:
        return False
    base = (api_url or "https://api.green-api.com").rstrip("/")
    settings = http_json("GET", f"{base}/waInstance{idi}/getSettings/{token}")
    live = str(settings.get("webhookUrl") or "").rstrip("/")
    out_api = str(settings.get("outgoingAPIMessageWebhook") or "")
    out_msg = str(settings.get("outgoingMessageWebhook") or "")
    incoming = str(settings.get("incomingWebhook") or "")
    ok = (
        live == CRM_WEBHOOK
        and out_api == "yes"
        and out_msg == "yes"
        and incoming == "yes"
    )
    if ok:
        print(f"ok project={project or '?'} instance={idi}")
        return False
    payload = {
        "webhookUrl": CRM_WEBHOOK,
        "webhookUrlToken": wh_token or "",
        "outgoingWebhook": "yes",
        "outgoingMessageWebhook": "yes",
        "outgoingAPIMessageWebhook": "yes",
        "incomingWebhook": "yes",
        "stateWebhook": "yes",
    }
    http_json("POST", f"{base}/waInstance{idi}/setSettings/{token}", payload)
    print(
        f"repaired project={project or '?'} instance={idi} "
        f"from={live or '(empty)'} bot_forward={bot_url or '(none)'}"
    )
    return True


def main() -> int:
    db = load_database_url()
    rows = psql(
        db,
        """
        select
          coalesce(id_instance::text,''),
          coalesce(api_token,''),
          coalesce(api_url,''),
          coalesce(webhook_token,''),
          coalesce(bot_webhook_url,''),
          coalesce(project_id::text,'')
        from whatsapp_config
        where id_instance is not null
          and api_token is not null
          and length(trim(api_token)) > 0
          and project_id is not null
        """,
    )
    if not rows:
        print("no bound instances")
        return 0
    repaired = 0
    for line in rows.splitlines():
        try:
            if ensure_row(line):
                repaired += 1
        except Exception as e:
            print(f"error: {e}", file=sys.stderr)
    print(f"done repaired={repaired}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as e:
        print(f"http {e.code}: {e.read()[:300]!r}", file=sys.stderr)
        raise SystemExit(1)
