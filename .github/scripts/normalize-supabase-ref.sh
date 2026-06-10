#!/usr/bin/env bash
# Нормализует SUPABASE_PROJECT_REF: только 20 букв, без URL.
set -euo pipefail
raw="${SUPABASE_PROJECT_REF:-mekwfbqmsqiborjdrjxc}"
ref="${raw#https://}"
ref="${ref#http://}"
ref="${ref%%.supabase.co*}"
ref="${ref##*/}"
ref="$(echo "$ref" | tr -d '[:space:]')"
if [[ ! "$ref" =~ ^[a-z]{20}$ ]]; then
  echo "::warning::Invalid SUPABASE_PROJECT_REF '$raw', using mekwfbqmsqiborjdrjxc"
  ref="mekwfbqmsqiborjdrjxc"
fi
echo "ref=$ref" >> "$GITHUB_OUTPUT"
echo "Using project ref: $ref"
