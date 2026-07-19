#!/usr/bin/env bash
# Poll until Vercel Hobby rate limit lifts, then push a [vercel-deploy] ping.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[$(date -u +%F\ %T)] vercel retry watcher started"

for _ in $(seq 1 72); do
  git fetch origin main >/dev/null 2>&1
  SHA=$(git rev-parse origin/main)
  SHORT=${SHA:0:7}
  DESC=$(gh api "repos/MarkVision2/markvision-a1/commits/${SHA}/status" \
    --jq '[.statuses[]|select(.context=="Vercel")|.description][0] // empty' 2>/dev/null || echo "")
  PROD=$(curl -fsS https://www.markvision.kz/lovable-sync.json \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("git_sha",""))' 2>/dev/null || echo "")

  echo "[$(date -u +%H:%M:%S)] vercel=\"${DESC}\" prod=${PROD} want=${SHORT}"

  case "${PROD}" in
    3c216ac|951428c|66b63eb|ffc13c7|"${SHORT}") echo "prod already has new UI"; exit 0 ;;
  esac

  # Wait until we have a definitive Vercel status that is NOT rate-limited
  if [ -z "${DESC}" ] || echo "${DESC}" | grep -qi "rate limited"; then
    sleep 1200
    continue
  fi

  # If Vercel already completed/building this sha, just wait for CDN
  if echo "${DESC}" | grep -qiE "completed|Building|Ready"; then
    sleep 180
    continue
  fi

  git checkout main
  git pull origin main
  date -u +%Y-%m-%dT%H:%M:%SZ > public/.vercel-deploy-ping
  git add public/.vercel-deploy-ping
  if git diff --staged --quiet; then
    echo "ping unchanged"
  else
    git commit -m "chore: retry production deploy after Hobby rate limit [vercel-deploy]"
    git push origin main
  fi

  sleep 180
done

echo "gave up after retries"
exit 1
