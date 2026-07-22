# Развёртывание монтажного контура на VPS (Hostinger)

Перенос всего монтажа на свой сервер: Python-пайплайн + Remotion + FFmpeg +
воркеры очереди + скиллы (`montage-pipeline`, `video-use` и др.) едут вместе с
репозиторием. Ниже — что нужно серверу, как поставить одним скриптом, как
включить авто-разбор очереди и как усилить SSH.

> **Почему я не сделал это по SSH из чата.** Облачная среда Claude Code выпускает
> наружу только HTTPS через свой прокси (порт 443). Исходящий порт 22 закрыт
> firewall'ом среды, ssh-клиента в контейнере нет, и прокси не туннелит 22-й порт.
> Это защитный контроль среды, обходить его нельзя. Поэтому вместо «зайти по ssh и
> потыкать руками» — идемпотентные скрипты ниже: ты запускаешь их на VPS (или
> запускаешь Claude Code в среде с доступом к 22), они сами проверяют, чего не
> хватает, и доставляют. `+2lB;…` из чата считай скомпрометированным — смени пароль
> root и переходи на ключи (шаг «Усиление SSH»).

## Что нужно серверу
| Компонент | Зачем | Ставит скрипт |
|---|---|---|
| Ubuntu 22.04/24.04 | база (Hostinger по умолчанию) | — |
| ffmpeg/ffprobe | прокси, declick, сжатие, рендер-аудио | ✓ |
| Python 3.11 + `.venv` | пайплайн (transcribe/faces/reels/audio…) | ✓ |
| Node 22 | Remotion 4, воркеры `scripts/*.mjs` | ✓ |
| Chromium (headless-shell) | рендер Remotion | ✓ |
| репозиторий + все deps | сам монтаж и скиллы | ✓ |
| Claude Code | монтажные сессии/авто-очередь на боксе | ✓ (опц.) |
| ключи в `.env` | Deepgram/ElevenLabs/Pexels/Supabase/worker | ты вставляешь |

## 1. Провижининг (одной командой, от root)
```bash
# на VPS
curl -fsSL https://raw.githubusercontent.com/MarkVision2/markvision-a1/main/deploy/vps-setup.sh -o vps-setup.sh
# либо scp этот файл. Затем:
REPO_URL="https://<GITHUB_TOKEN>@github.com/MarkVision2/markvision-a1.git" \
BRANCH="claude/ai-video-montage-setup-ivi8b2" \
bash vps-setup.sh
```
Скрипт **проверяет каждую зависимость и ставит только недостающее**, в конце
печатает отчёт. `<GITHUB_TOKEN>` — fine-grained PAT с доступом на чтение репо
(репозиторий приватный).

## 2. Ключи
```bash
nano /opt/markvision/markvision-a1/.env      # шаблон — deploy/.env.example
```
`MONTAGE_WORKER_KEY` должен совпадать с `montage_settings.worker_key` в Supabase.
Остальные ключи — те же, что в проекте (Deepgram, ElevenLabs, Pexels, Supabase).

## 3. Проверка
```bash
cd /opt/markvision/markvision-a1
.venv/bin/python tests/test_download.py         # смоук без сети
# тестовый рендер: возьми любой work/<id> с reels.json или запусти сессию:
claude                                           # монтажная сессия прямо на VPS
```
Ремоушн на сервере рендерит headless-shell'ом (в скрипте — `remotion browser
ensure` + системные libs). Если рендер падает на нехватке библиотек — доставь
пакеты из секции Chromium в `vps-setup.sh`.

## 4. Авто-разбор очереди (always-on)
Очередь с сайта (`reels_jobs` / `montage_jobs`) разбирает **Claude Code по таймеру**
— разметка сцен требует LLM, чистый shell-воркер её не заменит.
```bash
# один раз залогинь claude под деплой-юзером (или ANTHROPIC_API_KEY в .env)
sudo -u mv claude login

sudo cp deploy/markvision-queue.service /etc/systemd/system/
sudo cp deploy/markvision-queue.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now markvision-queue.timer
systemctl list-timers markvision-queue.timer     # проверить расписание
journalctl -u markvision-queue.service -f        # логи прогонов
```
Таймер каждые 15 мин запускает `deploy/queue-run.sh` → `claude -p "разбери
очередь…"` (tts → разметка + `brollQuery` → `reels-worker broll` → рендер
`ReelsExplainer` → publish в «Готовые» + Telegram). `flock` не даёт прогонам
наложиться. Правь `User=`/пути в unit-файлах под себя.

> Это заменяет мёртвый VPS-воркер из `CLAUDE.md`: теперь «мозг» монтажа живёт на
> твоём сервере, а не в разовой чат-сессии.

## 5. Усиление SSH («усиль SSH access»)
```bash
# сгенери ключ на СВОЁЙ машине:
ssh-keygen -t ed25519 -C "you@laptop"
# на VPS от root:
DEPLOY_USER="mv" SSH_PUBKEY="ssh-ed25519 AAAA… you@laptop" bash deploy/vps-harden.sh
```
Делает: non-root sudo-юзер `mv` + твой ключ, UFW (только SSH-порт), fail2ban
(бан за перебор), автоматические security-обновления, харденинг `sshd`
(`PermitRootLogin prohibit-password`, ограничение попыток). **Пароли не
отключаются сразу** — сначала проверь вход по ключу:
```bash
ssh mv@72.62.115.154
```
и только потом добей замок:
```bash
DISABLE_PASSWORDS=yes DEPLOY_USER=mv SSH_PUBKEY="ssh-ed25519 AAAA… you@laptop" bash deploy/vps-harden.sh
```
После этого смени root-пароль, что светился в чате.

## Файлы
- `vps-setup.sh` — провижининг рантайма (идемпотентно, с отчётом).
- `vps-harden.sh` — усиление SSH (юзер+ключ, UFW, fail2ban, sshd).
- `.env.example` — шаблон ключей.
- `queue-run.sh` + `markvision-queue.{service,timer}` — авто-разбор очереди.
