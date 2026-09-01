# MarkVision + Montage pipeline

В этом репозитории два контура:
- **MarkVision** — веб-приложение (Vite + React + Supabase): Контент-завод (`src/pages/CreateStep*`, `src/components/factory/`), AI монтаж через HeyGen (`src/pages/CreateMontage.tsx`), Reels, аналитика. Правила фронта — `LOVABLE.md`, ТЗ — `docs/*.md`.
- **Montage pipeline** — локальный автомонтаж «говорящей головы»: Python анализирует видео (транскрипт, дубли, лицо), Claude размечает вырезки и акценты, Remotion рендерит финал одним проходом (jump-cut, зумы на лицо, акцентные слова). Стек: Python 3.11 (`.venv`) + Remotion 4 (`remotion/`, Node 22) + FFmpeg + Deepgram API (`DEEPGRAM_API_KEY` в `.env`).

## Montage: старт
Когда пользователь просит смонтировать/сделать видео из съёмки («начать монтаж», «смонтируй видео», «запусти пайплайн», «шортсы из ролика»):
1. Прочитай скилл **`montage-pipeline`** (`.claude/skills/montage-pipeline/`) — оркестратор всего пайплайна.
2. Пути старта: новый стиль → скилл **`brand-intake`**; видео с нуля (ещё не снято) → **`script-gen`**; есть клип → Stage 1; только шортсы → shorts-only маршрут (Stage 1-lite); ремейк чужого шортса → Stage 2R.
3. Веди по стадиям, останавливаясь на воротах: сценарий (если был), `REVIEW.md`, брак сгенерённых картинок (`broll-gen`), финальный рендер, публикация в Контент-завод.
Ничего не рендерить и не пушить без явной команды пользователя.

## Связка с Контент-заводом
Два направления (детали — `docs/MONTAGE-LAB.md` и раздел «Очередь Контент-завода» в скилле `montage-pipeline`):
- **Заявки с сайта**: Контент-завод → Видео → «Монтаж съёмки» (страница `/create/montage-lab`) кладёт
  заявку в `montage_jobs` (исходник — bucket `montage-uploads`). Очередь разбирает Claude-сессия:
  `node scripts/montage-worker.mjs next` → монтаж по скиллу (без чатовых ворот, brief заявки — вход
  разметки) → `… status <jobId> "…"` для прогресса → `… complete <jobId> --video …` (заливка в bucket
  `renders`, публикация в «AI монтаж → Готовые», отправка в Telegram проекта). Команда пользователя
  «разбери очередь монтажа» = обработать все заявки.
- **Ручной монтаж из чата**: финальный рендер публикуется командой
  `node scripts/montage-publish.mjs --project <projectId> --video out/main169.mp4 --title "…"`.
- **Reels-видео (faceless графика под ИИ-озвучку)**: сайт (Контент-завод → «Reels-видео»)
  кладёт заявку (сценарий/ТЗ + голос ElevenLabs + опции) в `reels_jobs`. VPS-воркер мёртв —
  очередь разбирает Claude-сессия (команда «разбери очередь reels») по скиллу/доке
  `docs/REELS-PIPELINE.md`: озвучка `scripts/reels-worker.mjs tts` (edge `reels-tts`,
  ключ `ELEVENLABS_API_KEY` в секретах Supabase) → `transcribe.py` → разметка сцен
  `work/<id>/reels.json` → `pipeline/reels.py` → рендер `ReelsExplainer` →
  `scripts/reels-worker.mjs publish` (в `reels_usage` + Telegram). Голоса — `src/lib/elevenVoices.ts`
  (клон «Юрий» по умолчанию).
Обе дороги идут через edge-функцию `montage-worker` (auth: `MONTAGE_WORKER_KEY` из `.env` =
`montage_settings.worker_key`). Тексты для публикации (описание, теги, ТГ-пост) — скилл
**`publish-pack`** → `work/<id>/publish.md`.

- **Автопубликация готового видео в аккаунты площадок** (Instagram/TikTok/YouTube/Threads):
  очередь `publish_jobs` + edge-функции `publish-*`, оркестрация заявок и отчётов — в n8n.
  Детали, контракты endpoint'ов и онбординг аккаунтов — `docs/PUBLISHING-SYSTEM.md`.

## Карта (montage-часть)
- `pipeline/` — Python-скрипты анализа (transcribe → indexed → edl → review → faces → props → audio); shorts.py (шортсы), download.py + reference.py (ремейк референса по ссылке)
- `remotion/` — Node-проект Remotion; `src/Main169.tsx` (16:9), `src/Shorts916.tsx` (9:16), `src/Root.tsx` — регистрация композиций. Пропсы генерятся пайплайном; `props/*.example.json` — для запуска Studio из коробки. Новое видео = новый `main169_*.json` + своя `<Composition>` в Root.tsx (id без `_`)
- `remotion/public/` — `source.mp4` (прокси исходника), declick-дорожка, шрифты, вставки `inserts/<id>/` (в git не попадает)
- `work/<id>/` — артефакты по каждому видео (в git не попадают): script.md, words.json, delete.json, edl.json, faces.json, accents.json, REVIEW.md, publish.md и т.д.
- `docs/PIPELINE.md`, `docs/REMOTION.md`, `docs/brandbook.md` — детали пайплайна, композиций и стиля
- `tests/test_download.py` — смоук без сети: `python tests/test_download.py`
- `out/` — финальные рендеры (в git не попадают)
- `.env` — `DEEPGRAM_API_KEY`; для ремейка по ссылке — `SCRAPECREATORS_API_KEY`, `APIFY_TOKEN`

## Команды (Linux/macOS: `.venv/bin/python`; Windows: `.venv\Scripts\python.exe`)
```bash
python -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt   # окружение пайплайна

.venv/bin/python pipeline/<script>.py ...        # анализ, детали в docs/PIPELINE.md

# Remotion (из ./remotion)
npx remotion studio                      # превью — ТОЛЬКО так
npx tsc --noEmit                         # typecheck
npx remotion compositions src/index.ts   # проверить регистрацию

# пропсы: 3-й арг = базовое имя медиа в public (source по умолчанию):
.venv/bin/python pipeline/props.py work/<id> remotion/props/main169.json source
# declick-дорожка спикера (после props.py; перезапускать после любой правки монтажа):
.venv/bin/python pipeline/audio.py remotion/props/main169.json
# шортсы: отбор в work/<id>/shorts.json → пропсы → declick-дорожка на каждый:
.venv/bin/python pipeline/shorts.py work/<id> remotion/props    # + "... draft" для вычитки
.venv/bin/python pipeline/audio.py remotion/props/<id>.json     # на каждый шорт
# ремейк: скачать референс-шортс по ссылке (дальше reference.py):
.venv/bin/python pipeline/download.py "<url>" work/<id>

# финал — только по явной команде пользователя:
npx remotion render src/index.ts Main169 ../out/main169.mp4 --props=props/main169.json --image-format=png --crf=14 --x264-preset=slow

# публикация рендера в Контент-завод (раздел «AI монтаж → Готовые»):
node scripts/montage-publish.mjs --project <projectId> --video out/main169.mp4 --title "…"
```

## Правила (montage — не нарушать)
- **Превью НЕ рендерить файлом** — смотреть в Remotion Studio. Финальный рендер только по явной команде.
- **ProRes не делать. Звук не обрабатывать** (нормализация/шумодав запрещены; в прокси `-c:a copy`). Исключение: 6-мс гейт + дещелчок на краях склеек.
- **Звук спикера = declick-дорожка**, не звук из `<Video>`: Main169 глушит `<Video>` (`muted={audioTrack!=null}`) и играет `<Audio audioTrack>`.
- Версии-пины: TypeScript 5.9.3 (7.x ломает Remotion), zod 4.3.6, mediapipe 0.10.21 (новее — нет `.solutions`).
- `@remotion/media`: тримы `<Video>`/`<Audio>` (`trimBefore`/`trimAfter`) — в КАДРАХ, не секундах.
- Remotion `id` композиции: только `a-z A-Z 0-9 - CJK`, **без `_`**. Шортсы: id `Short-*`.
- Исходники HEVC → обязательно прокси all-intra H.264 (`-crf 15 -g 1 -bf 0 -c:a copy`) в `remotion/public`.
- Композиция всегда равна целевому разрешению (1920×1080 / 1080×1920) — иначе мыло.
- Правка монтажа = правка `work/<id>/delete.json` → edl.py → props.py → **audio.py** (не руками в edl.json).
- Deepgram filler_words не работает для русского — паразиты/дубли размечает Claude в `delete.json`.
- Стиль текста в кадре — по `docs/brandbook.md` (свой бренд — через `brand-intake` → `brand.config.json`).
