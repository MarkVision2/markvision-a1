#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Auto-queue runner: process pending Reels + Montage jobs on the VPS by driving
# Claude Code headless with the repo's skills. This is how the montage "brain"
# (scene markup, b-roll choice, publish) runs unattended on your own box.
#
# Scene markup needs an LLM, so a pure shell worker can't replace it — instead we
# hand the queue to Claude Code (`claude -p`) which reads docs/REELS-PIPELINE.md +
# the montage-pipeline skill and runs tts → markup → broll → render → publish→TG.
#
# Requires: `claude` installed and authenticated as this user (run `claude login`
# once, or set ANTHROPIC_API_KEY in .env). Wire it to a timer via the units in
# this folder. Serialized by flock so two runs never collide.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/markvision/markvision-a1}"
LOCK="/tmp/markvision-queue.lock"
LOG_DIR="${LOG_DIR:-$APP_DIR/logs}"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"

exec 9>"$LOCK"
flock -n 9 || { echo "another queue run is in progress — exiting"; exit 0; }

cd "$APP_DIR"
set -a; [ -f .env ] && . ./.env; set +a
export PATH="$APP_DIR/.venv/bin:$PATH"

PROMPT='Разбери очередь монтажа и очередь reels: обработай все ожидающие заявки по скиллу montage-pipeline и доке docs/REELS-PIPELINE.md. Для «Видео с озвучкой» обязательно собери живой видео-б-ролл (scene.brollQuery → scripts/reels-worker.mjs broll) и рендери движком ReelsExplainer. Публикуй результат в «Готовые» и Telegram проекта. Не задавай уточняющих вопросов, не жди подтверждений — заявки с сайта это и есть вход. Если очередь пуста, ничего не делай.'

echo "[$TS] queue run start" | tee -a "$LOG_DIR/queue.log"
# Unattended runs need a non-interactive permission policy. Prefer an explicit
# tool allowlist in the deploy user's ~/.claude/settings.json (least privilege).
# If you accept the risk of a fully non-interactive box, export in the unit:
#   CLAUDE_FLAGS="--dangerously-skip-permissions"
# Left empty by default so nothing broad runs without you opting in.
claude -p "$PROMPT" ${CLAUDE_FLAGS:-} >>"$LOG_DIR/queue-$TS.log" 2>&1 \
  && echo "[$TS] queue run ok" | tee -a "$LOG_DIR/queue.log" \
  || { echo "[$TS] queue run FAILED (see queue-$TS.log)" | tee -a "$LOG_DIR/queue.log"; exit 1; }
