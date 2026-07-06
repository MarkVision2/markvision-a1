#!/usr/bin/env python3
"""Починить INSERT-ы из Lovable под схему szfg перед импортом."""
from __future__ import annotations

import re
import sys
from pathlib import Path

GENERATED_COLS = {"sipuni_token_present", "meta_access_token_present"}
JSONB_DOW = re.compile(r"'(\[[\d,\s]+\])'::jsonb")


def fix_days_of_week(line: str) -> str:
    def repl(m: re.Match[str]) -> str:
        arr = m.group(1).replace(" ", "")
        inner = arr.strip("[]")
        return f"ARRAY[{inner}]"

    return JSONB_DOW.sub(repl, line)


def strip_generated_columns(line: str) -> str:
    if "automation_settings" not in line:
        return line
    m = re.match(
        r"(INSERT INTO public\.automation_settings \()([^)]+)(\) VALUES \()(.+)(\);)\s*$",
        line,
        re.DOTALL,
    )
    if not m:
        return line
    cols = [c.strip() for c in m.group(2).split(",")]
    vals_raw = m.group(4)
    # naive split respecting quotes — automation_settings is single-row, flat values
    vals = split_sql_values(vals_raw)
    if len(cols) != len(vals):
        return line
    kept_cols, kept_vals = [], []
    for c, v in zip(cols, vals):
        if c in GENERATED_COLS:
            continue
        kept_cols.append(c)
        kept_vals.append(v)
    return (
        f"INSERT INTO public.automation_settings ({', '.join(kept_cols)}) "
        f"VALUES ({', '.join(kept_vals)});"
    )


def split_sql_values(s: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    in_str = False
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == "'" and not in_str:
            in_str = True
            cur.append(ch)
        elif ch == "'" and in_str:
            if i + 1 < len(s) and s[i + 1] == "'":
                cur.append("''")
                i += 1
            else:
                in_str = False
                cur.append(ch)
        elif ch == "," and not in_str:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    if cur:
        out.append("".join(cur).strip())
    return out


def fix_leads_auth(line: str) -> str:
    if not line.startswith("INSERT INTO public.leads"):
        return line
    # auth.users не переносим
    return re.sub(
        r"(, (?:TRUE|FALSE)), '[0-9a-f-]{36}', '[0-9a-f-]{36}', ('[0-9]{4}-)",
        r"\1, NULL, NULL, \2",
        line,
    )


def fix_file(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    lines = []
    changed = 0
    for raw in text.splitlines():
        line = raw
        new = fix_leads_auth(strip_generated_columns(fix_days_of_week(line)))
        if new != line:
            changed += 1
        lines.append(new)
    if changed:
        path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return changed


def main() -> None:
    dump_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "./tmp/lovable-dump/manual")
    total = 0
    for p in sorted(dump_dir.glob("*.sql")):
        n = fix_file(p)
        if n:
            print(f"  fixed {n} lines in {p.name}")
            total += n
    print(f"Done: {total} line(s) patched in {dump_dir}")


if __name__ == "__main__":
    main()
