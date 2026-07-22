# ТЗ: развернуть монтажный контур на VPS (Hostinger)

## 1. Цель
Перенести весь монтаж MarkVision на собственный VPS, чтобы:
- заявки с сайта («Видео с озвучкой» → `reels_jobs`, «Монтаж съёмки» → `montage_jobs`)
  монтировались **автоматически** на сервере, а не в разовой чат-сессии;
- каждый ролик «Видео с озвучкой» собирался с **живым видео-б-роллом** (движок
  `ReelsExplainer`, клипы играют как видео) и уходил в «Готовые» + Telegram проекта;
- доступ к серверу был безопасным (ключи вместо паролей, firewall, fail2ban).

## 2. Что подготовить до старта
- **VPS Hostinger**: Ubuntu 22.04 или 24.04, минимум **2 vCPU / 4 GB RAM / 20 GB** диска
  (рендер Remotion — CPU-bound; меньше 4 GB рискованно). Доступ root.
- **GitHub PAT** (fine-grained, только чтение репо `MarkVision2/markvision-a1`) — репо
  приватный, нужен для клонирования.
- **SSH-ключ** на своей машине: `ssh-keygen -t ed25519 -C "ты@ноут"` (пригодится в п.6).
- **Ключи API** (те же, что в проекте): `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`,
  `PEXELS_API_KEY`, `MONTAGE_WORKER_KEY` (= `montage_settings.worker_key` в Supabase),
  и Supabase-переменные (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CLIENT_SUPABASE_URL`,
  `VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY`).
- **Ключ/логин Claude Code** для авто-очереди: либо `ANTHROPIC_API_KEY`, либо один раз
  `claude login` под деплой-юзером.

Все скрипты уже в репозитории в папке `deploy/`.

## 3. Задача A — Провижининг рантайма
Запустить на VPS от root:
```bash
REPO_URL="https://<PAT>@github.com/MarkVision2/markvision-a1.git" \
BRANCH="claude/ai-video-montage-setup-ivi8b2" \
bash <(curl -fsSL -H "Authorization: token <PAT>" \
  https://raw.githubusercontent.com/MarkVision2/markvision-a1/claude/ai-video-montage-setup-ivi8b2/deploy/vps-setup.sh)
```
Скрипт идемпотентный: проверяет и доставляет **ffmpeg, Python 3.11+.venv, Node 22,
Chromium (headless-shell для Remotion), репозиторий, все Python/Node-зависимости,
Claude Code**, печатает отчёт. Ставится в `/opt/markvision/markvision-a1`.

**Готово, если:** отчёт без ошибок, `ffmpeg -version`, `node -v` (≥22),
`.venv/bin/python -c "import mediapipe"` — все отвечают.

## 4. Задача B — Ключи
```bash
nano /opt/markvision/markvision-a1/.env   # шаблон — deploy/.env.example
```
Вставить все ключи из п.2. **`MONTAGE_WORKER_KEY` должен совпадать** с
`montage_settings.worker_key` в Supabase, иначе edge-функции вернут 403.

**Готово, если:** в `.env` заполнены все строки, пустых ключей нет.

## 5. Задача C — Проверка монтажа (один прогон)
```bash
cd /opt/markvision/markvision-a1
.venv/bin/python tests/test_download.py    # смоук без сети — должен пройти
claude                                     # монтажная сессия на VPS: "разбери очередь reels"
```
Прогнать одну тестовую заявку (или из чата) от начала до конца: озвучка → разметка
сцен (+ `brollQuery`) → `scripts/reels-worker.mjs broll` → рендер `ReelsExplainer` →
публикация.

**Готово, если:** получился `out/reels_*.mp4`, ролик появился в «AI монтаж → Готовые»
и пришёл в Telegram проекта, б-роллы **двигаются** (не статичные фото).

## 6. Задача D — Авто-разбор очереди (always-on)
```bash
sudo -u mv claude login        # или ANTHROPIC_API_KEY в .env
sudo cp /opt/markvision/markvision-a1/deploy/markvision-queue.service /etc/systemd/system/
sudo cp /opt/markvision/markvision-a1/deploy/markvision-queue.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now markvision-queue.timer
```
Таймер каждые 15 минут запускает `deploy/queue-run.sh` → Claude Code разбирает
`reels_jobs`/`montage_jobs`. Для полностью неинтерактивного бокса — выставить в
unit `Environment=CLAUDE_FLAGS=--dangerously-skip-permissions` (осознанно) либо
прописать allowlist инструментов в `~/.claude/settings.json` деплой-юзера.

**Готово, если:** `systemctl list-timers markvision-queue.timer` показывает
расписание; после подачи новой заявки с сайта она **сама** уходит в готовые +
Telegram в течение ~15 мин; `journalctl -u markvision-queue.service` без ошибок.

## 7. Задача E — Усилить SSH
```bash
DEPLOY_USER="mv" SSH_PUBKEY="ssh-ed25519 AAAA… ты@ноут" \
  bash /opt/markvision/markvision-a1/deploy/vps-harden.sh
```
Создаёт non-root sudo-юзера `mv` + твой ключ, включает UFW (только SSH-порт),
fail2ban, авто-security-обновления, харденинг sshd. **Пароли не отключает сразу.**
Проверить вход по ключу:
```bash
ssh mv@72.62.115.154
```
и только после этого добить замок:
```bash
DISABLE_PASSWORDS=yes DEPLOY_USER=mv SSH_PUBKEY="ssh-ed25519 AAAA… ты@ноут" \
  bash /opt/markvision/markvision-a1/deploy/vps-harden.sh
```

**Готово, если:** вход по ключу под `mv` работает, вход по паролю и root по паролю
отключены (`ssh root@… ` c паролем отбивается), `ufw status` = active,
`fail2ban-client status sshd` показывает джейл.

## 8. Безопасность (обязательно)
- **Сменить root-пароль**, который светился в переписке — считать скомпрометированным.
- `.env` на VPS никому не показывать, в git не коммитить (уже в `.gitignore`).
- PAT — с минимальными правами (только чтение репо), при желании удалить после клона.

## 9. Итоговые критерии приёмки
1. Runtime стоит, тестовый рендер прошёл, ролик в «Готовые» + Telegram, б-ролл живой.
2. Таймер включён, новая заявка с сайта разбирается автоматически.
3. SSH: ключ работает, пароли выключены, UFW + fail2ban активны, root-пароль сменён.
