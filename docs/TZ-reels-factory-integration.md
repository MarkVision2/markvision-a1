# ТЗ: интеграция Reels Factory в «Контент-завод»

**Дата:** 2026-07-09
**Автор:** Юрий + Claude
**Статус:** черновик к согласованию

---

## 1. Резюме

Переносим движок настольного приложения **AI Reels Factory** (`reels-factory-desktop`) в веб-платформу
**MarkVision** (`markvision-a1`), в раздел «Контент-завод». Пользователь вставляет сценарий → получает
готовый вертикальный Reels (озвучка + титры + подобранные кадры + музыка) прямо в галерее раздела,
без установки программы и без включённого компьютера.

**Принятые решения:**
- **Рендер:** headless-воркер на VPS (Hostinger, всегда онлайн). Не десктоп, не Vercel serverless.
- **API-ключи:** ключи платформы (ElevenLabs / Pexels / FAL / HeyGen держим на сервере, пользователь их не видит).

**Ключевой инсайт:** движок (`reels-factory-desktop/src/*.js`) — это чистый headless-Node с вшитым ffmpeg.
Electron был только оболочкой. Логика faceless-рендера изначально серверная (перенос `api/ai-montage-direct.js`).
Поэтому движок переносится на VPS практически без переписывания.

---

## 2. Что уже есть (переиспользуем)

### 2.1 Движок рендера (`reels-factory-desktop/src/`)
Точка входа: `pipeline.js` → `generateVideo({ script, config, onProgress }) → mp4`.

| Модуль | Роль |
|--------|------|
| `pipeline.js` | оркестратор: текст → озвучка → блоки → подбор кадров → ffmpeg → mp4 |
| `render-core.js` | ffmpeg-рендер (faceless/avatar), вшитый `ffmpeg-static`, ASS-титры через libass |
| `match.js` | подбор сегментов (локальные клипы + Pexels) |
| `tts.js` / `freedom-tts.js` | озвучка: ElevenLabs (с таймкодами слов) и Freedom Speech (каз/рус) |
| `stt.js` | распознавание слов для титров, когда TTS не даёт таймкоды |
| `local-content.js` | каталог биролов, музыка, бриф проекта |
| `heygen.js` | путь avatar-видео (HeyGen) |
| `remotion-overlay.js` | анимированные титры + CTA через **Remotion + headless Chromium** → webm с альфой |
| `templates.js`, `overlay-spec.js`, `reference.js` | стиль-шаблоны, спецификация оверлея |

**Вход `config` (что задаёт клиент):** `script`, `voiceProvider` (elevenlabs/freedom), `voiceId`/`freedomVoice`,
`videoMode` (faceless/avatar), `template`/формат, `musicUrl`, `genProvider` (none/fal/kie) + `genMax`, `activeProject`.
**Вход `config` (что инжектит воркер):** `elevenKey`, `freedomKey`, `pexelsKey`, `falKey`, `kieKey`, `heygenKey`,
`openaiKey` — из env платформы. **Клиент ключи не передаёт и не видит.**

### 2.2 Платформа (`markvision-a1`)
- Vite + React + shadcn, деплой на **Vercel**, бэкенд — Supabase (Clony `szfgdruhlebfvcmlvxdk`).
- Раздел «Контент-завод» — маршрут `/`, в сайдбаре `{ title: "Контент-завод", icon: Wand2 }`.
- Текущие типы контента: `src/data/contentTypes.ts` (fb/google ads, insta-carousel, reels-cover, stories,
  youtube-thumb, neuro-photo). **Видео/Reels-типа пока нет.**
- Сабмит генерации: `contentFactoryPayload.ts` → edge `content-factory-proxy` → n8n webhook `clony-yurii`.
- Галерея: `ContentFactoryGallery.tsx` поллит таблицу `content_factory_results` (интервал 15 с).

### 2.3 Готовый аналог — путь HeyGen (копируем его архитектуру 1-в-1)
Видео HeyGen уже сделано именно так, как нам надо:
- Очередь задач → таблица `heygen_jobs` (`session_id`, script, status).
- Результат → таблица `heygen_usage` (`video_url`, `cover_url`, `duration_sec`, `cost_usd`, `title`).
- Галерея `HeygenGallery.tsx` поллит `heygen_usage` через React Query.
- Воркер забирает job → зовёт API → пишет результат.

**Reels делаем зеркально этому паттерну**, только вместо вызова HeyGen API — локальный ffmpeg-рендер на VPS.

---

## 3. Целевая архитектура

```
Пользователь в «Контент-заводе»
        │  выбирает тип «Reels-видео», вводит сценарий + настройки
        ▼
[Frontend markvision-a1]  → enqueueReelsJob() → INSERT reels_jobs (RLS, config без ключей)
        │  (напрямую из браузера, как heygen_jobs — edge-функция не нужна)
        ▼
[VPS worker  reels-worker] ── поллит reels_jobs (queued) каждые 5 c
        │  1. атомарно клеймит job (status=rendering)
        │  2. инжектит ключи платформы из .env
        │  3. generateVideo({ script, config, onProgress }) → mp4 + обложка
        │  4. заливает в Supabase Storage bucket `reels`
        │  5. INSERT reels_usage (video_url, cover_url) + status=done
        ▼
[Frontend ReelsGallery]   → React Query поллит reels_usage по project_id → <video>
```

---

## 4. Компоненты и объём работ

### 4.1 База данных (Supabase, миграции)

**Таблица `reels_jobs`** (очередь):

| Колонка | Тип | Назначение |
|---------|-----|-----------|
| `id` | uuid pk | |
| `project_id` | uuid | принадлежность проекту (RLS) |
| `session_id` | text | сессия клиента |
| `status` | text | `queued` / `rendering` / `done` / `error` |
| `script` | text | сценарий |
| `config` | jsonb | настройки БЕЗ ключей (voiceProvider, format, musicUrl, genProvider…) |
| `progress` | int | 0–100, пишет воркер через `onProgress` |
| `stage` | text | текстовый статус («озвучка», «подбор кадров», «рендер») |
| `error` | text | текст ошибки |
| `worker_id` | text | кто взял job |
| `attempts` | int | счётчик ретраев |
| `created_at` / `updated_at` | timestamptz | |

**Таблица `reels_usage`** (результат, по образцу `heygen_usage`):

| Колонка | Тип |
|---------|-----|
| `id` | uuid pk |
| `job_id` | uuid → reels_jobs |
| `project_id` | uuid |
| `video_url` | text |
| `cover_url` | text |
| `duration_sec` | numeric |
| `title` | text |
| `cost_usd` | numeric (себестоимость рендера для учёта) |
| `created_at` | timestamptz |

- **RLS:** `user_can_access_project(project_id)` или admin — как в существующих таблицах.
- **Storage:** переиспользуем существующий bucket **`renders`** (public), путь `reels/{project_id}/{job_id}.mp4` + `reels/{project_id}/{job_id}.jpg`. Новый bucket не нужен. Биролы — в существующем bucket `brolls`.
- **Атомарный клейм job** воркером: `UPDATE reels_jobs SET status='rendering', worker_id=… WHERE id=(SELECT id FROM reels_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *` (через RPC-функцию, т.к. REST не даёт SKIP LOCKED — оформить как SQL-функцию `claim_reels_job`).

### 4.2 Edge function `reels-enqueue` (Deno)
- Принимает payload от фронта, валидирует (сценарий не пустой, project_id, лимиты).
- Проверяет лимит проекта (сколько reels уже за период — по `reels_usage`).
- `INSERT reels_jobs (status='queued')`, возвращает `job_id`.
- **Ключи не проходят через фронт и edge — их подставляет только воркер.**

### 4.3 VPS-воркер `reels-worker` (главный объём)
Отдельный headless-Node сервис на Hostinger VPS (systemd, как `tg-claude-bridge` / tg-userbot).

**Порт кода:** взять `reels-factory-desktop/src/*.js` целиком, убрать Electron-специфику
(`main.js`, `app.js`, `preload.cjs`, IPC, окна, автообновление). Обернуть в цикл-поллер.

**Провижининг VPS (важно — из-за Remotion):**
- Node 20+, ffmpeg покрыт `ffmpeg-static` (Linux-бинарь ставится сам).
- **Chromium** (`/usr/bin/chromium` или chrome-stable) — нужен для Remotion-оверлея (`ensureBrowser`).
- Нативный `@remotion/compositor-linux-x64` — ставится с `@remotion/renderer`.
- Prebuilt `remotion-bundle/` перенести на VPS (или собрать `scripts/bundle-remotion.mjs`).
- Шрифты для титров, музыкальная библиотека, каталог биролов (см. риск 6.2).
- `.env` с ключами платформы: `ELEVEN_KEY`, `FREEDOM_KEY`, `PEXELS_KEY`, `FAL_KEY`, `KIE_KEY`,
  `HEYGEN_KEY`, `OPENAI_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

**Цикл воркера:**
1. Поллит `claim_reels_job` каждые 5 с. **Параллелизм = 1–2** (ffmpeg+Remotion тяжёлые).
2. Собирает `config`: клиентские поля из `reels_jobs.config` + ключи из env.
3. `generateVideo({ script, config, onProgress })`; `onProgress` → `UPDATE reels_jobs.progress/stage`.
4. Заливает mp4 + обложку (первый кадр через ffmpeg) в Storage bucket `reels`.
5. `INSERT reels_usage`, `UPDATE reels_jobs status='done'`.
6. Ошибка → `status='error'`, `error=…`, `attempts+1`; ретрай до N раз, потом стоп.

### 4.4 Frontend (`markvision-a1`)
- **Новый тип контента** «Reels-видео» в `src/data/contentTypes.ts` (категория Content или AI).
- **Форма** (по образцу существующего wizard'а): сценарий (textarea), провайдер/голос озвучки,
  формат/стиль (маппинг на `template`), музыка (пресеты), тумблер ИИ-кадров + лимит, бренд-шаблон.
- **Сабмит:** `supabase.functions.invoke("reels-enqueue", { body })` вместо n8n-прокси.
- **Галерея `ReelsGallery.tsx`** — копия `HeygenGallery.tsx`: React Query поллит `reels_usage` по
  `project_id`, рендерит `<video src={video_url}>` + кнопка скачать. Плюс индикатор прогресса
  «в очереди / рендерится N%» из `reels_jobs`.
- Учёт лимитов/себестоимости — как в `heygenUsage.ts`.

---

## 5. Фазы внедрения

| Фаза | Что | Результат |
|------|-----|-----------|
| **0. Выделение движка** ✅ | вынести `src/*` в папку/пакет `reels-engine`, убрать Electron, прогнать `generateVideo()` из CLI на Mac | ✅ **СДЕЛАНО 2026-07-09.** `render-cli.mjs` рендерит Reels 1080×1920 h264 за 37 c без Electron. В `src/` нет импортов electron. Дефолт идёт через ASS-титры (`remotionOverlay=false`) → Chromium для базового пути НЕ нужен |
| **1. VPS-провижининг** ⛔ | Node + ffmpeg + `.env`; (Chromium НЕ нужен — ASS-путь). Прогнать воркер на VPS | ⛔ **ЗАБЛОКИРОВАНО:** подписка Hostinger кончилась, VPS не отвечает (port22 timeout). Как оживёт — деплой по `reels-render-worker/README.md` (git clone + npm ci + .env + systemd) |
| **2. БД** ✅ | миграции `reels_jobs`, `reels_usage`, RPC `claim_reels_job`, RLS | ✅ **СДЕЛАНО 2026-07-09** в Clony. 19+15 колонок, 4 RLS-политики (зеркало heygen), индексы, updated_at-триггер. Сквозной тест insert→claim→cleanup прошёл. Bucket НЕ создавали — переиспользуем существующий `renders` |
| **3. Воркер** ✅ | обернуть движок в поллер + Storage-заливка + запись результата, systemd `reels-worker` | ✅ **СДЕЛАНО + ПРОВЕРЕНО 2026-07-09.** Отдельный репо **`reels-render-worker`** (github.com/zapoinov13/reels-render-worker) — движок вынесен из `reels-factory-desktop` в `engine/` без Electron, `worker.mjs`, `.env.example`, `.service`, `README`. Проверен end-to-end против прода (job→рендер→`renders`→`reels_usage`), автономно без `@remotion` (ASS-путь). Десктоп-репо очищен. Осталось запустить на VPS (Фаза 1) |
| **4. Edge** ⏭️ | ~~`reels-enqueue`~~ | ⏭️ **НЕ НУЖНА.** HeyGen ставит задачу в очередь прямо из браузера через RLS-клиент (`heygenUsage.ts:68`), не через edge. Reels делает так же — `enqueueReelsJob()` пишет в `reels_jobs`, RLS скоупит по проекту. Валидацию/лимиты вынесем позже при необходимости |
| **5. Фронт** ✅ | тип контента + форма + `ReelsGallery` + прогресс | ✅ **СДЕЛАНО 2026-07-09.** `reelsQueue.ts` + `ReelsGallery.tsx` + `CreateReels.tsx` (route `/create/reels`, карточка в `VideoContentGrid`). tsc 0 ошибок. Ждёт только воркер (Фаза 3), чтобы задачи начали исполняться |
| **6. Полировка** | себестоимость/лимиты, обложки, ретраи, алерты об ошибках | продакшен |

Первый видимый результат — после Фазы 3 (сквозной рендер, пусть и с ручной постановкой задачи).

---

## 6. Риски и открытые вопросы

1. **Нагрузка на VPS.** ffmpeg + Remotion (headless Chrome) прожорливы. Проверить CPU/RAM Hostinger.
   Если рендер душит бота/n8n на том же VPS — вынести отдельный render-VPS. Параллелизм держать 1–2,
   очередь сглаживает пики. Оценить время рендера на серверном железе (на десктопе 1–2 мин).
2. **Каталог биролов.** ⚠️ Частично снят: в Supabase уже есть bucket **`brolls`** (public) — движку `match.js`
   надо скормить каталог оттуда вместо Google Drive. Остаётся: наполнить банк и научить воркер читать `brolls`
   (сейчас десктоп качает из Drive). Решить, общий это банк или per-project. Правило: **без темнокожих** (ЦА Казахстан).
3. **Remotion на Linux.** `remotion-overlay.js` требует системный Chromium + нативный компоновщик. Есть
   запасной путь — ASS-титры через libass (`render-core.js:153`) без Chrome. Если Remotion на VPS будет
   нестабилен — можно временно переключить оверлей на ASS.
4. **Копирайт-правила Юрия** (из памяти): **никаких «—» (длинных тире)** в титрах/CTA; текст латиницей;
   время — Павлодар (UTC+5). Проверить, что движок это соблюдает (в montage-engine уже была системная замена).
5. **Себестоимость.** При ключах платформы каждый рендер = расход (ElevenLabs символы, Pexels бесплатно,
   FAL/HeyGen дорого за клип/видео). Нужны лимиты на проект и учёт `cost_usd` в `reels_usage`.
6. **Прогресс в UI.** `onProgress` движка → `reels_jobs.progress` → фронт. Убедиться, что `onProgress`
   даёт осмысленные этапы (озвучка/подбор/рендер), а не только 0→100.

---

## 7. Что НЕ делаем в этой итерации
- Не тащим Telegram-бот десктопа (у платформы свой канал — веб-форма).
- Не тащим автообновление/установщик Electron.
- Пользовательские ключи и биллинг по подписке — отдельная итерация (сейчас ключи платформы).
