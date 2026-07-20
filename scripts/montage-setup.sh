#!/usr/bin/env bash
# Идемпотентная подготовка воркера монтаж-конвейера (свежая облачная сессия
# или новая машина): ffmpeg + Python-окружение + зависимости Remotion.
# Запуск из корня репозитория: bash scripts/montage-setup.sh
# Код возврата != 0 => монтаж невозможен, причина в stdout.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

# ── Ключи: из окружения или .env ────────────────────────────────────────────
need_key() {
  local name="$1"
  if [ -z "${!name:-}" ] && ! grep -q "^${name}=" .env 2>/dev/null; then
    echo "✗ Нет ${name} (задайте в env-переменных окружения Claude или в .env)"
    fail=1
  else
    echo "✓ ${name} задан"
  fi
}
need_key DEEPGRAM_API_KEY
need_key MONTAGE_WORKER_KEY

# ── Сеть: без доступа к Supabase/R2/Deepgram воркер бесполезен ──────────────
# /auth/v1/health без apikey отвечает 401 — это нормально, главное что TLS/DNS живы.
_code=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" \
  "https://szfgdruhlebfvcmlvxdk.supabase.co/auth/v1/health" 2>/dev/null || echo "000")
if [ "$_code" != "000" ]; then
  echo "✓ Сеть до Supabase есть (HTTP $_code)"
else
  echo "✗ Нет сети до szfgdruhlebfvcmlvxdk.supabase.co — откройте сетевую политику окружения"
  fail=1
fi

[ "$fail" -ne 0 ] && { echo "-- Подготовка прервана: исправьте пункты выше."; exit 1; }

# ── ffmpeg: системный или статическая сборка в .tools ───────────────────────
if command -v ffmpeg >/dev/null 2>&1; then
  echo "✓ ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"
else
  echo "… ставим статический ffmpeg в .tools/"
  mkdir -p .tools
  curl -fL --retry 3 -o .tools/ffmpeg.tar.xz \
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" \
    && tar -xf .tools/ffmpeg.tar.xz -C .tools --strip-components=1 \
    && rm -f .tools/ffmpeg.tar.xz
  if [ -x .tools/ffmpeg ]; then
    ln -sf "$PWD/.tools/ffmpeg" /usr/local/bin/ffmpeg 2>/dev/null || true
    ln -sf "$PWD/.tools/ffprobe" /usr/local/bin/ffprobe 2>/dev/null || true
    command -v ffmpeg >/dev/null 2>&1 || export PATH="$PWD/.tools:$PATH"
    echo "✓ ffmpeg установлен ($(.tools/ffmpeg -version | head -1 | cut -d' ' -f3)); если PATH не подхватился: export PATH=\"$PWD/.tools:\$PATH\""
  else
    echo "✗ Не удалось поставить ffmpeg"; exit 1
  fi
fi

# ── Python-окружение пайплайна ───────────────────────────────────────────────
if [ ! -x .venv/bin/python ]; then
  echo "… создаём .venv"
  python3 -m venv .venv || { echo "✗ python3 -m venv не удался"; exit 1; }
fi
if ! .venv/bin/python -c "import mediapipe, soundfile, cv2, dotenv, requests" 2>/dev/null; then
  echo "… ставим зависимости пайплайна"
  .venv/bin/pip install -q -r pipeline/requirements.txt || { echo "✗ pip install не удался"; exit 1; }
fi
echo "✓ Python-окружение готово"

# ── Remotion ────────────────────────────────────────────────────────────────
if [ ! -d remotion/node_modules ]; then
  echo "… npm ci в remotion/"
  (cd remotion && npm ci --silent) || { echo "✗ npm ci не удался"; exit 1; }
fi
echo "✓ Remotion готов"

# ── SFX для рендера (key.wav обязателен для акцентов в Main169) ──────────────
mkdir -p remotion/public
if [ -f assets/sfx/key.wav ]; then
  cp -f assets/sfx/key.wav remotion/public/key.wav
  echo "✓ key.wav скопирован в remotion/public"
elif [ ! -f remotion/public/key.wav ]; then
  ffmpeg -y -f lavfi -i sine=frequency=1200:duration=0.04 \
    -af "afade=t=out:st=0.02:d=0.02" -ac 1 -ar 44100 \
    remotion/public/key.wav >/dev/null 2>&1 \
    && echo "✓ key.wav сгенерирован" \
    || echo "⚠ не удалось создать key.wav — рендер акцентов упадёт"
fi

echo "-- Воркер готов. Очередь: node scripts/montage-worker.mjs next"
