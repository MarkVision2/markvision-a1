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
    --jq '[.statuses[]|select(.context=="Vercel")|.description][0]' 2>/dev/null || echo "unknown")
  PROD=$(curl -fsS https://www.markvision.kz/lovable-sync.json \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("git_sha",""))' 2>/dev/null || echo "")

  echo "[$(date -u +%H:%M:%S)] vercel=\"${DESC}\" prod=${PROD} want=${SHORT}"

  case "${PROD}" in
    3c216ac|951428c|"${SHORT}") echo "prod already has new UI"; exit 0 ;;
  esac

  if echo "${DESC}" | grep -qi "rate limited"; then
    sleep 1200
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

  sleep 120
  PROD2=$(curl -fsS https://www.markvision.kz/lovable-sync.json \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("git_sha",""))' 2>/dev/null || echo "")
  echo "after push prod=${PROD2}"
  if [ "${PROD2}" != "9c3447b" ]; then
    echo SUCCESS
    exit 0
  fi
  sleep 1200
done

echo "gave up after retries"
exit 1
