#!/usr/bin/env bash
# Session-start hook for Claude Code on the web.
# Goal: make sure the project, the Playwright tooling and the playwright-skill
# are ready to use the moment a new container spins up.
set -euo pipefail

cd "$(dirname "$0")/../.."

log() { echo "[claude-session-start] $*"; }

# 1. Install JS deps if missing
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  log "installing npm dependencies"
  npm install --no-audit --no-fund --silent
fi

# 2. Install Playwright skill node modules
SKILL_DIR=".claude/skills/playwright-skill"
if [ -d "$SKILL_DIR" ] && [ ! -d "$SKILL_DIR/node_modules" ]; then
  log "installing playwright-skill deps"
  (cd "$SKILL_DIR" && npm install --no-audit --no-fund --silent)
fi

# 3. Try to install Chromium for Playwright; non-fatal if the sandbox blocks it.
if command -v npx >/dev/null 2>&1; then
  if ! npx --no-install playwright --version >/dev/null 2>&1; then
    log "playwright cli not yet available, skipping browser install"
  else
    log "ensuring chromium is installed (skip if network is restricted)"
    npx playwright install chromium >/dev/null 2>&1 || \
      log "chromium install skipped (network policy may block cdn.playwright.dev)"
  fi
fi

log "ready"
