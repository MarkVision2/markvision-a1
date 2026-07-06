#!/usr/bin/env bash
# Собрать all.sql из CSV, экспортированного из Lovable SQL Editor
# (колонки table_name, line — или одна колонка line)
set -euo pipefail

CSV="${1:?usage: ./03-split-lovable-csv.sh export.csv [out_dir]}"
OUT_DIR="${2:-./tmp/lovable-dump/manual}"

mkdir -p "$OUT_DIR"

python3 - "$CSV" "$OUT_DIR" <<'PY'
import csv
import os
import sys
from collections import defaultdict

csv_path = sys.argv[1]
out_dir = sys.argv[2]

tables = defaultdict(list)
all_lines = []

with open(csv_path, newline='', encoding='utf-8-sig') as f:
    first_line = f.readline()
    f.seek(0)
    if ';' in first_line and 'table_name' in first_line:
        delim = ';'
    elif '\t' in first_line:
        delim = '\t'
    else:
        delim = ','
    reader = csv.DictReader(f, delimiter=delim)
    fields = reader.fieldnames or []
    has_table = 'table_name' in fields or 'tbl' in fields
    line_key = 'line' if 'line' in fields else fields[-1] if fields else None
    table_key = 'table_name' if 'table_name' in fields else ('tbl' if 'tbl' in fields else None)

    if not line_key:
        raise SystemExit('CSV must have column "line"')

    for row in reader:
        line = (row.get(line_key) or '').strip()
        if not line or not line.upper().startswith('INSERT'):
            continue
        all_lines.append(line)
        if has_table and table_key:
            tbl = (row.get(table_key) or 'misc').strip()
            tables[tbl].append(line)

os.makedirs(out_dir, exist_ok=True)

with open(os.path.join(out_dir, 'all.sql'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(all_lines) + '\n')

for tbl, lines in tables.items():
    if tbl and tbl != 'misc':
        with open(os.path.join(out_dir, f'{tbl}.sql'), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')

print(f'Wrote {len(all_lines)} INSERTs → {out_dir}/all.sql')
print(f'Split into {len(tables)} table files')
PY

echo ""
echo "Импорт:"
echo "  export SUPABASE_DB_PASSWORD='...'"
echo "  ./scripts/migrate-to-szfg/04-import-data.sh $OUT_DIR"
