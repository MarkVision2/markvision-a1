#!/usr/bin/env python3
"""Fallback diagnose when DB password is missing: service role secret or Management API."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REF = os.environ["SUPABASE_PROJECT_REF"]
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
PID = os.environ.get("PROJECT_ID", "cceb9a86-687b-4417-9b4e-d106bd8cc79c")
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
OUT = Path("/tmp/diag-out")
OUT.mkdir(parents=True, exist_ok=True)


def http(method: str, url: str, headers: dict, body: bytes | None = None) -> tuple[int, str]:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def dump_via_service_role(key: str) -> None:
    base = f"https://{REF}.supabase.co/rest/v1"
    hdr = {"apikey": key, "Authorization": f"Bearer {key}"}
    tables = [
        ("heygen_jobs", "id,status,source,created_at,updated_at,delivered,error,script,montage_brief,aspect,session_id,video_url"),
        ("heygen_usage", "id,mode,source,created_at,title,ref_id,duration_sec,cost_usd,video_url,description"),
        ("montage_jobs", "id,status,created_at,updated_at,error,source_name,brief"),
        ("reels_jobs", "id,status,created_at,updated_at,error,script"),
    ]
    for table, sel in tables:
        code, raw = http("GET", f"{base}/{table}?select={sel}&project_id=eq.{PID}&order=created_at.desc&limit=20", hdr)
        (OUT / f"{table}.json").write_text(raw, encoding="utf-8")
        print(f"==== {table} HTTP {code} ====")
        print(raw[:5000])
    code, raw = http(
        "GET",
        f"{base}/heygen_jobs?select=id,status,source,created_at,script,montage_brief,error,project_id"
        f"&or=(script.ilike.*маркетинг*,montage_brief.ilike.*маркетинг*,script.ilike.*тишина*,montage_brief.ilike.*тишина*)"
        f"&order=created_at.desc&limit=20",
        hdr,
    )
    (OUT / "heygen_search.json").write_text(raw, encoding="utf-8")
    print(f"==== search HTTP {code} ====")
    print(raw[:4000])


def dump_via_mgmt() -> int:
    sql = f"""
select 'heygen_jobs' as src, id::text, coalesce(status,'') as status, coalesce(source,'') as source,
       created_at::text, left(coalesce(script,''),200) as script, left(coalesce(error,''),200) as err
from public.heygen_jobs
where project_id = '{PID}'
order by created_at desc limit 15;
"""
    body = json.dumps({"query": sql}).encode()
    code, raw = http(
        "POST",
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        body,
    )
    (OUT / "mgmt_query.json").write_text(raw, encoding="utf-8")
    print(f"mgmt query HTTP {code}")
    print(raw[:3000])

    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=24)
    logs_url = (
        f"https://api.supabase.com/v1/projects/{REF}/analytics/endpoints/logs.edge-logs"
        f"?iso_timestamp_start={start.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        f"&iso_timestamp_end={end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )
    code2, raw2 = http("GET", logs_url, {"Authorization": f"Bearer {TOKEN}"})
    (OUT / "edge_logs.json").write_text(raw2, encoding="utf-8")
    print(f"edge logs HTTP {code2}")
    print(raw2[:4000])
    low = raw2.lower()
    for needle in ["heygen", "video_agent", "insufficient", "credit", "heygen-jobs-worker", "heygen-proxy"]:
        if needle in low:
            print("FOUND", needle)
    return 0 if code == 200 or code2 == 200 else 1


def main() -> int:
    if SERVICE:
        print("Using SUPABASE_SERVICE_ROLE_KEY secret")
        dump_via_service_role(SERVICE)
        return 0
    print("No SERVICE_ROLE secret; trying Management API")
    return dump_via_mgmt()


if __name__ == "__main__":
    raise SystemExit(main())
