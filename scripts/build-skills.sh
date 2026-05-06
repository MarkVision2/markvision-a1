#!/usr/bin/env bash
# Regenerate supabase/functions/_marketing_os/skills.gen.ts from the SKILL.md sources.
# Run this after editing any SKILL.md or references/*.md in supabase/functions/_marketing_os/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/supabase/functions/_marketing_os"
OUT="$DIR/skills.gen.ts"

{
  echo "// AUTO-GENERATED from supabase/functions/_marketing_os/**/SKILL.md"
  echo "// Do not edit by hand — re-run scripts/build-skills.sh after editing the source markdown."
  echo ""
  for slug in onboarding creatives content site-brief site-build; do
    var=$(echo "$slug" | tr '-' '_')
    echo "export const ${var}Skill = String.raw\`"
    sed 's/`/\\`/g; s/\${/\\${/g' "$DIR/$slug/SKILL.md"
    echo ""
    echo "\`;"
    echo ""
    if [ -d "$DIR/$slug/references" ]; then
      for ref in "$DIR/$slug/references/"*.md; do
        refname=$(basename "$ref" .md | tr '-' '_')
        echo "export const ${var}_${refname}Ref = String.raw\`"
        sed 's/`/\\`/g; s/\${/\\${/g' "$ref"
        echo ""
        echo "\`;"
        echo ""
      done
    fi
  done
} > "$OUT"

echo "wrote $OUT ($(wc -l < "$OUT") lines)"
