#!/usr/bin/env bash
# Verifies full-site audit plan (P0–P2) artifacts are present in the repo.
set -euo pipefail
cd "$(dirname "$0")/.."

run() { eval "$1" >/dev/null 2>&1 || { echo "FAIL: $1"; exit 1; }; }

run "test -f src/hooks/useTaskReminders.ts"
run '! rg -q useCrmStore src/components/crm/TaskReminderToast.tsx'
run 'rg -q LEADS_LITE_QUERY_KEY src/hooks/useLeadsLite.ts'
run 'rg -q useQuery src/hooks/useLeadsLite.ts'
run 'test -f src/hooks/useMetaDashboard.ts'
run 'rg -q useMetaDashboard src/pages/Dashboard.tsx'
run 'rg -q PAGE_SIZE src/components/ads/AdsCreativesPanel.tsx'
run '! rg -q autoPlay src/components/ads/CreativeCard.tsx src/components/dashboard/CreativesGrid.tsx'
run 'rg -q "const \\[mediaError, setMediaError\\]" src/components/dashboard/CreativesGrid.tsx'
run 'rg -q "Без креатива" src/pages/CreativeFunnel.tsx'
run 'rg -q useVirtualizer src/components/crm/StageColumn.tsx'
run 'rg -q chatsByLeadId src/components/crm/ChatsView.tsx'
run 'rg -q lazy src/pages/Crm.tsx'
run 'test -f .github/workflows/ci.yml'
run 'grep -q "\"ci\"" package.json'
run 'test ! -f src/test/example.test.ts'
run 'test -f src/test/leads-lite-query.test.ts'
run 'rg -q "name: \"404\"" tests/e2e/smoke.spec.ts'


run "test -f supabase/functions/ig-organic-redirect/index.ts"
run "test -f src/pages/ContentAnalytics.tsx"
run 'rg -q "const ContentAnalytics = lazy" src/App.tsx'
run 'rg -q "useCodewordLeads" src/hooks/useInstagramOrganic.ts'
run 'rg -q "recordInstagramOrganicLead" supabase/functions/lead-intake/index.ts'
run 'rg -q "cw: z.string" supabase/functions/lead-intake/index.ts'

echo "Full site audit plan: all checks passed"
