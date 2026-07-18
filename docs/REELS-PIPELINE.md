# Reels-видео (faceless графика под озвучку)

Раздел сайта **Контент-завод → Reels-видео**: пользователь шлёт сценарий/ТЗ, выбирает
голос (ElevenLabs) и опции — на выходе вертикальный ролик 9:16 с ИИ-озвучкой,
кинетическими титрами и графикой из моушн-базы. Лица нет (faceless).

Второй контур озвучки — **клон голоса**: в аккаунте ElevenLabs есть клон «Юрий»,
он стоит по умолчанию в селекторе (`src/lib/elevenVoices.ts`).

## Как заказывается (сайт)
`/create/reels` (`src/pages/CreateReels.tsx`) → сценарий + **голос** (`ReelsConfig.elevenVoice`,
voice_id из `ELEVEN_VOICES`) + формат/музыка + источник B-roll → `enqueueReelsJob` кладёт
заявку в **`reels_jobs`** (`status='queued'`, `config`). Источники:
- `auto` — моушн-база/автогенерация;
- `library` — случайная подборка из выбранных `reels_asset_folders` проекта;
- `pexels` — вертикальные стоковые видео через проектный Pexels API key;
- `kie` — генерация 9:16 через Kie.ai, модель Kling 2.1 Master.

Ключи Pexels/Kie.ai сохраняются через `reels-project-settings` зашифрованными в
`reels_provider_credentials`; в браузер и `reels_jobs.config` они не возвращаются.
Файлы медиатеки лежат в bucket `reels-assets`, метаданные — `reels_assets`.
Прогресс и готовые ролики видны в галерее раздела (`reels_usage`).

## Как разбирается (Claude-сессия)
VPS-воркер Reels Factory **мёртв**, поэтому очередь разбирает Claude-сессия по этому
маршруту (команда пользователя «разбери очередь reels»). Ключ ElevenLabs живёт в
секретах Supabase (edge-функция `reels-tts`), а не в браузере/воркере.

1. **Взять заявку.** `reels_jobs` (queued) — через Supabase (MCP/SQL): прочитать
   `script` + `config` (в т.ч. `elevenVoice`, `brollMode`, `assetFolderIds`), пометить
   `status='rendering'`. Затем `node scripts/reels-worker.mjs sources <jobId>` →
   `work/<id>/reels-sources.json`: случайный пул файлов выбранных папок или fallback
   `auto`. Для внешних источников:
   - `node scripts/reels-worker.mjs pexels <jobId> --query "..."`;
   - `node scripts/reels-worker.mjs kie-create <jobId> --prompt "..."`, затем
     `kie-status <jobId> --task <taskId>`.
2. **Озвучка.** `node scripts/reels-worker.mjs tts <jobId> --voice <voiceId>` →
   edge `reels-tts` синтезит mp3 (`eleven_multilingual_v2`, русский), кладёт в bucket
   `renders` и качает в `remotion/public/reels/vo_<id>.mp3`.
3. **Тайминги слов.** `.venv/bin/python pipeline/transcribe.py remotion/public/reels/vo_<id>.mp3 work/<id> ru`
   → `work/<id>/words.json`.
4. **Разметка сцен ПО СМЫСЛУ.** Claude пишет `work/<id>/reels.json` (шапка
   `pipeline/reels.py`): непрерывная лента сцен `{anchorWord,endWord,template,data}`,
   шаблоны из `docs/motion-library.md` подбираются по смыслу фразы, цвета — разные;
   короткие карточки оставляют караоке-строку, «текстовые» шаблоны её прячут.
5. **Пропсы.** `.venv/bin/python pipeline/reels.py work/<id> remotion/props <audio_dur_sec>`
   → `remotion/props/Reels-<id>.json`. Плюс тихий бит в `remotion/public/reels/beat_<id>.wav`.
6. **Рендер** (композиция `ReelsExplainer`, 1080×1920, из `./remotion`):
   ```bash
   CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
   npx remotion render src/index.ts ReelsExplainer ../out/reels_<id>.mp4 \
     --props=props/Reels-<id>.json --image-format=png --crf=18 --browser-executable="$CHROME"
   ```
   (в этом окружении Chromium не качается — только пред-установленный headless_shell.)
7. **Публикация.** `node scripts/reels-worker.mjs publish <jobId> --video out/reels_<id>.mp4
   --title "…" --description "…"` — заливка в `renders`, запись в «Готовые»
   (`reels_usage`), `reels_jobs.status='done'`, отправка в Telegram проекта.
   `--no-telegram` — без ТГ.

## Композиция `remotion/src/ReelsExplainer.tsx`
Пропсы `ReelsExplainerProps`: `audioTrack`, `words` (караоке), `scenes[]`
(`{from,to,template,data}`), `totalDurationInFrames`, `music?`, `musicVolume?`,
`captions?`. Кадр всегда живой: анимированный `SceneBackground` (орбитящие
свечения, световой свип, вращающиеся кольца, параллакс-сетка) + слой частиц +
дыхание/дрейф контента + слайд-переходы + полоса прогресса сверху.

## Edge-функция `supabase/functions/reels-tts` (verify_jwt off, x-montage-key)
- `voices` — список голосов аккаунта (`GET /v1/voices`).
- `tts {text, voiceId, path}` — синтез → upload в `renders` → `{publicUrl}`.
- `sign_upload {path}` — signed upload URL в `renders`.
- `publish {jobId, videoUrl, title?, description?, durationSec?, notifyTelegram?}`
  — `reels_usage` + `reels_jobs=done` + Telegram проекта.

Секрет `ELEVENLABS_API_KEY` — в Supabase → Edge Functions → Secrets.
