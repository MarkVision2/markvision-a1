#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MarkVision Montage — provisioning for a fresh VPS (Ubuntu 22.04/24.04, Hostinger).
# Idempotent: run it as many times as you like. It CHECKS every dependency the
# montage/reels pipeline needs and installs only what's missing, printing a report.
#
# Installs: system libs, ffmpeg, Python 3.11 (+venv), Node 22, the repo, all deps,
# Chromium (headless-shell) for Remotion renders, and (optionally) Claude Code so
# you can run montage sessions on the box exactly like locally.
#
# Usage (as root or with sudo):
#   REPO_URL="https://<token>@github.com/MarkVision2/markvision-a1.git" \
#   BRANCH="claude/ai-video-montage-setup-ivi8b2" \
#   bash vps-setup.sh
#
# After it finishes, fill /opt/markvision/markvision-a1/.env (template printed at
# the end) and test one render — see deploy/VPS-DEPLOY.md.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${REPO_URL:-}"                       # https://<token>@github.com/MarkVision2/markvision-a1.git
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/markvision}"
NODE_MAJOR="${NODE_MAJOR:-22}"
INSTALL_CLAUDE="${INSTALL_CLAUDE:-yes}"        # set to "no" to skip Claude Code CLI

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo bash vps-setup.sh)"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
REPORT=()

# ── 1. base system packages ──────────────────────────────────────────────────
log "System packages"
apt-get update -qq
BASE=(git curl ca-certificates gnupg build-essential pkg-config unzip jq \
      python3 python3-venv python3-pip ffmpeg)
MISSING=()
for p in "${BASE[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if [ "${#MISSING[@]}" -gt 0 ]; then
  warn "installing: ${MISSING[*]}"; apt-get install -y -qq "${MISSING[@]}"
  REPORT+=("installed apt: ${MISSING[*]}")
else ok "all base packages present"; fi
have ffmpeg && ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"

# ── 2. Node 22 (NodeSource) ──────────────────────────────────────────────────
log "Node.js $NODE_MAJOR"
NEED_NODE=yes
if have node; then
  cur="$(node -v | sed 's/v//;s/\..*//')"
  [ "$cur" -ge "$NODE_MAJOR" ] && { NEED_NODE=no; ok "node $(node -v) present"; } \
                               || warn "node $(node -v) too old, upgrading"
fi
if [ "$NEED_NODE" = yes ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
  REPORT+=("installed node $(node -v)")
  ok "node $(node -v) / npm $(npm -v)"
fi

# ── 3. clone / update repo ───────────────────────────────────────────────────
log "Repository"
mkdir -p "$APP_DIR"
DEST="$APP_DIR/markvision-a1"
if [ -d "$DEST/.git" ]; then
  git -C "$DEST" fetch --all -q && git -C "$DEST" checkout -q "$BRANCH" && git -C "$DEST" pull -q origin "$BRANCH" || warn "git update skipped"
  ok "repo present, on $(git -C "$DEST" rev-parse --abbrev-ref HEAD)"
else
  [ -n "$REPO_URL" ] || { echo "REPO_URL not set and repo not cloned yet — pass REPO_URL=https://<token>@github.com/MarkVision2/markvision-a1.git"; exit 1; }
  git clone -q --branch "$BRANCH" "$REPO_URL" "$DEST"
  REPORT+=("cloned repo → $DEST")
  ok "cloned to $DEST"
fi
cd "$DEST"

# ── 4. Python venv + pipeline deps ───────────────────────────────────────────
log "Python pipeline env (.venv)"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r pipeline/requirements.txt
ok "pipeline deps installed"
# video-use skill deps (lazy — heavy). Comment out if you don't use it on the VPS.
if [ -f .claude/skills/video-use/pyproject.toml ]; then
  ./.venv/bin/pip install -q -e .claude/skills/video-use && ok "video-use skill deps installed" || warn "video-use deps failed (non-fatal)"
fi

# ── 5. Node deps (root app + remotion) ───────────────────────────────────────
log "Node deps"
npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
ok "root node_modules ready"
( cd remotion && (npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund) ) && ok "remotion node_modules ready"

# ── 6. Chromium headless-shell for Remotion ──────────────────────────────────
log "Chromium (Remotion renderer)"
# Remotion needs a Chrome to render. Install its bundled headless shell + OS libs.
apt-get install -y -qq \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpango-1.0-0 libcairo2 fonts-liberation libu2f-udev 2>/dev/null || \
  apt-get install -y -qq libasound2t64 2>/dev/null || true
( cd remotion && npx --yes remotion browser ensure ) && ok "remotion browser ready" \
  || warn "remotion browser ensure failed — check libs above"

# ── 7. Claude Code (run montage sessions on the VPS) ─────────────────────────
if [ "$INSTALL_CLAUDE" = yes ]; then
  log "Claude Code CLI"
  if have claude; then ok "claude present ($(claude --version 2>/dev/null || echo installed))"
  else npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 && { REPORT+=("installed claude code"); ok "claude installed"; } \
       || warn "claude install failed (install manually: npm i -g @anthropic-ai/claude-code)"; fi
fi

# ── 8. .env template ─────────────────────────────────────────────────────────
log ".env"
if [ ! -f .env ]; then
  cp deploy/.env.example .env 2>/dev/null || cat > .env <<'ENV'
# Fill these in — the pipeline/worker read them.
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
PEXELS_API_KEY=
MONTAGE_WORKER_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_CLIENT_SUPABASE_URL=
VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=
ENV
  warn ".env created — EDIT IT with your real keys before running the worker"
  REPORT+=(".env created (needs keys)")
else ok ".env already present"; fi

# ── report ───────────────────────────────────────────────────────────────────
log "Done. Summary"
if [ "${#REPORT[@]}" -eq 0 ]; then ok "everything was already in place"; else
  for r in "${REPORT[@]}"; do echo "  • $r"; done
fi
cat <<EOF

Next:
  1) nano $DEST/.env          # paste real keys
  2) cd $DEST && .venv/bin/python tests/test_download.py   # smoke test (no network)
  3) run a montage session:   cd $DEST && claude
  4) enable auto-queue:       see deploy/VPS-DEPLOY.md (systemd worker)
EOF
