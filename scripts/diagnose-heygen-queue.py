#!/usr/bin/env python3
"""Dump recent heygen/montage/reels jobs for MarkVision AI (CI diagnose)."""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REF = os.environ["SUPABASE_PROJECT_REF"]
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PID = os.environ.get("PROJECT_ID", "cceb9a86-687b-4417-9b4e-d106bd8cc79c")
OUT = Path(os.environ.get("DIAG_OUT", "/tmp/diag-out"))
OUT.mkdir(parents=True, exist_ok=True)

KEEP = {
    "id", "status", "source", "created_at", "updated_at", "delivered", "error",
    "error_message", "script", "montage_brief", "aspect", "session_id", "video_url",
    "project_id", "chat_id", "title", "brief", "prompt", "mode", "ref_id",
    "duration_sec", "cost_usd", "description", "cover_url", "thumbnail_url",
    "source_name",
}
TRIM = {"script", "montage_brief", "brief", "prompt", "description", "error", "error_message"}


def http_json(url: str, headers: dict[str, str]) -> object:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def trim_row(row: dict) -> dict:
    keep = {k: row.get(k) for k in row if k in KEEP}
    for k in TRIM:
        v = keep.get(k)
        if isinstance(v, str) and len(v) > 240:
            keep[k] = v[:240] + "…"
    return keep


def main() -> int:
    keys_url = f"https://api.supabase.com/v1/projects/{REF}/api-keys"
    keys = http_json(keys_url, {"Authorization": f"Bearer {TOKEN}"})
    if not isinstance(keys, list):
        print("api-keys unexpected:", keys, file=sys.stderr)
        return 1
    print("keys_count", len(keys))
    print("names", [x.get("name") or x.get("id") for x in keys])

    service_key = ""
    for k in keys:
        name = (k.get("name") or k.get("id") or "").lower()
        if name in ("service_role", "service role"):
            service_key = k.get("api_key") or k.get("key") or ""
            break
    if not service_key:
        for k in keys:
            val = k.get("api_key") or k.get("key") or ""
            if val.startswith("eyJ") or "service" in (k.get("name") or "").lower():
                service_key = val
                break
    if not service_key:
        print("Could not resolve service_role key", file=sys.stderr)
        return 1
    print(f"Got service key (len={len(service_key)})")

    base = f"https://{REF}.supabase.co/rest/v1"
    hdr = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Prefer": "count=exact",
    }

    tables = [
        (
            "heygen_jobs",
            "id,status,source,created_at,updated_at,delivered,error,script,montage_brief,aspect,session_id,video_url,project_id,chat_id",
            f"project_id=eq.{PID}",
        ),
        (
            "heygen_usage",
            "id,mode,source,created_at,title,ref_id,duration_sec,cost_usd,video_url,description,project_id",
            f"project_id=eq.{PID}",
        ),
        (
            "montage_jobs",
            "id,status,created_at,updated_at,error,project_id,source_name,brief",
            f"project_id=eq.{PID}",
        ),
        (
            "reels_jobs",
            "id,status,created_at,updated_at,error,project_id,script",
            f"project_id=eq.{PID}",
        ),
    ]

    for table, select, filt in tables:
        print(f"===== {table} =====")
        url = f"{base}/{table}?select={select}&{filt}&order=created_at.desc&limit=15"
        try:
            data = http_json(url, hdr)
        except Exception as e:
            print(f"error fetching {table}: {e}")
            (OUT / f"{table}.json").write_text(json.dumps({"error": str(e)}), encoding="utf-8")
            continue
        (OUT / f"{table}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        if isinstance(data, dict) and data.get("message"):
            print(json.dumps(data, ensure_ascii=False))
            continue
        for row in (data or [])[:15]:
            print(json.dumps(trim_row(row), ensure_ascii=False))

    print("===== heygen_jobs text search =====")
    q = urllib.parse.urlencode({
        "select": "id,status,source,created_at,script,montage_brief,error,project_id",
        "or": "(script.ilike.*маркетинг*,montage_brief.ilike.*маркетинг*)",
        "order": "created_at.desc",
        "limit": "10",
    })
    try:
        search = http_json(f"{base}/heygen_jobs?{q}", hdr)
        print(json.dumps(search, ensure_ascii=False, indent=2)[:4000])
        (OUT / "heygen_jobs_search.json").write_text(
            json.dumps(search, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as e:
        print(f"search error: {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
