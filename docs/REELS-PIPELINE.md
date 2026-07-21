# Reels-видео (faceless графика под озвучку)

Раздел сайта **Контент-завод → Reels-видео**: пользователь шлёт сценарий/ТЗ, выбирает
голос (ElevenLabs) и опции — на выходе вертикальный ролик 9:16 с ИИ-озвучкой,
кинетическими титрами и графикой из моушн-базы. Лица нет (faceless).

Второй контур озвучки — **клон голоса**: в аккаунте ElevenLabs есть клон «Юрий»,
он стоит по умолчанию в селекторе (`src/lib/elevenVoices.ts`).

## Как заказывается (сайт)
`/create/reels` (`src/pages/CreateReels.tsx`) → сценарий + **голос** (`ReelsConfig.elevenVoice`,
voice_id из `ELEVEN_VOICES`) + формат/музыка/ИИ-кадры → `enqueueReelsJob` кладёт заявку
в **`reels_jobs`** (`status='queued'`, `config`). Прогресс и готовые ролики видны в
галерее раздела (`reels_usage`).

## Как разбирается (Claude-сессия)
VPS-воркер Reels Factory **мёртв**, поэтому очередь разбирает Claude-сессия по этому
маршруту (команда пользователя «разбери очередь reels»). Ключ ElevenLabs живёт в
секретах Supabase (edge-функция `reels-tts`), а не в браузере/воркере.

1. **Взять заявку.** `reels_jobs` (queued) — через Supabase (MCP/SQL): прочитать
   `script` + `config` (в т.ч. `elevenVoice`), пометить `status='rendering'`.
2. **Озвучка.** `node scripts/reels-worker.mjs tts <jobId> --voice <voiceId>` →
   edge `reels-tts` синтезит mp3 (`eleven_multilingual_v2`, русский), кладёт в bucket
   `renders` и качает в `remotion/public/reels/vo_<id>.mp3`.
3. **Тайминги слов.** `.venv/bin/python pipeline/transcribe.py remotion/public/reels/vo_<id>.mp3 work/<id> ru`
   → `work/<id>/words.json`.
4. **Разметка сцен ПО СМЫСЛУ.** Claude пишет `work/<id>/reels.json` (шапка
   `pipeline/reels.py`): непрерывная лента сцен `{anchorWord,endWord,template,data}`,
   шаблоны из `docs/motion-library.md` подбираются по смыслу фразы, цвета — разные;
   короткие карточки оставляют караоке-строку, «текстовые» шаблоны её прячут.
   **У каждой сцены, где нужен живой футаж, ставим `brollQuery`** — короткий
   английский запрос по смыслу фразы (см. карту в `docs/broll-rules.md`; людей
   по цвету кожи/этничности НЕ фильтруем). CTA-сцену обычно оставляем без футажа.
4.5. **Живой видео-б-ролл (обязательный шаг для «полу-пустых» роликов).**
   `node scripts/reels-worker.mjs broll <jobId>` — по полям `brollQuery` тянет
   вертикальные клипы (Pexels → edge `reels-broll`, ключ `PEXELS_API_KEY` в секретах),
   качает их в `remotion/public/broll/<id>/` и проставляет `scene.clip` в `reels.json`.
   Клипы играют как ЖИВОЕ видео 5-7 с (движок — `OffthreadVideo` + `Sequence`,
   а НЕ `@remotion/media` Video: тот замерзал на первом кадре при headless-рендере,
   б-ролл выглядел статичным фото). Нет подходящего стока → ИИ-кадр через edge
   `reels-gen` (kie.ai/FLUX, `KIE_API_KEY`) как `scene.image`.
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
(`{from,to,template,data,clip?,clipFrom?,image?}`), `totalDurationInFrames`,
`music?`, `musicVolume?`, `captions?`. Кадр всегда живой: анимированный
`SceneBackground` (орбитящие свечения, световой свип, вращающиеся кольца,
параллакс-сетка) + слой частиц + дыхание/дрейф контента + слайд-переходы +
полоса прогресса сверху.
- **`scene.clip`** — живой видеофутаж на весь кадр (`BrollMedia`): рендерится
  через `OffthreadVideo` внутри `Sequence from={scene.from}`, поэтому клип
  реально проигрывается со своего начала под сценой (5-7 с движения), а не
  застывает на первом кадре. `clipFrom` — тримминг начала в КАДРАХ.
- **`scene.image`** — ИИ-картинка с ken-burns (медленный зум+пан), fallback когда
  живого стока нет. Поверх футажа — тёмные градиенты + акцентная виньетка.

## Edge-функция `supabase/functions/reels-tts` (verify_jwt off, x-montage-key)
- `voices` — список голосов аккаунта (`GET /v1/voices`).
- `tts {text, voiceId, path}` — синтез → upload в `renders` → `{publicUrl}`.
- `sign_upload {path}` — signed upload URL в `renders`.
- `publish {jobId, videoUrl, title?, description?, durationSec?, notifyTelegram?}`
  — `reels_usage` + `reels_jobs=done` + Telegram проекта.

Секрет `ELEVENLABS_API_KEY` — в Supabase → Edge Functions → Secrets.

## Edge-функции б-ролла (verify_jwt off, x-montage-key)
Сессия Claude не достаёт Pexels/kie.ai напрямую (egress 403) — проксируем через
Supabase, клипы/кадры кладутся в bucket `renders`, дальше их качает `reels-worker broll`.
- `reels-broll` — `pexels {jobId, queries[], orientation, perQuery}` → ищет в Pexels,
  берёт вертикальный mp4 (h≥w, ближе к 1920), качает в `renders/broll/<jobId>/`,
  отдаёт `{query,url,dur,w,h}`. Секрет `PEXELS_API_KEY`.
- `reels-gen` — `flux {jobId, prompt, aspectRatio?}` → kie.ai/FLUX (createTask →
  poll → download), кадр в `renders/broll/<jobId>/gen-*.png`, `{url,kind}`.
  Секрет `KIE_API_KEY`. Использовать как `scene.image`, когда стока нет.
