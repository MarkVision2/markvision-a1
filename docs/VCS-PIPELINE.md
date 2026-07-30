# Вертикальные креативы (video-creative-system) → Контент-завод

Новая очередь Контент-завода для вертикальных VoiceOver-креативов, которые
собирает внешняя система [video-creative-system](https://github.com/dengineproblem/video-creative-system-public)
(озвучка ElevenLabs → пословные тайминги → раскадровка → рендер Remotion
1080×1920: кинетические титры, инфографика, клипарт). Архитектура повторяет
Reels/Montage: сайт кладёт заявку, Claude-сессия разбирает очередь, результат
публикуется в «AI монтаж → Готовые».

## Поток

1. **Сайт** — Контент-завод → Видео → «Вертикальные креативы» (`/create/vcs`,
   `src/pages/CreateVcs.tsx`). Пользователь вводит сценарий (текст озвучки),
   выбирает профиль (`kinetic_clipart_v4` / `classic`), голос ElevenLabs,
   скорость и музыку. `enqueueVcsJob` (`src/lib/vcsQueue.ts`) кладёт заявку в
   `vcs_jobs` (RLS по проекту, ключи провайдеров в `config` НЕ попадают).
2. **Очередь** — Claude-сессия в репо video-creative-system разбирает `vcs_jobs`
   через edge-функцию `vcs-worker` (auth: `x-montage-key` = `MONTAGE_WORKER_KEY`
   = `montage_settings.worker_key`) и CLI `scripts/vcs-worker.mjs`:
   - `node scripts/vcs-worker.mjs next` — забрать заявку (script + config);
   - прогон пайплайна video-creative-system (озвучка → тайминги → рендер);
   - `… status <jobId> "…"` — прогресс;
   - `… complete <jobId> --video <mp4> [--title …] [--review-url …]` — заливка в
     bucket `renders`, публикация в `heygen_usage` (mode=`vcs`) → «AI монтаж →
     Готовые», отправка в Telegram проекта.
3. **Готовые** — ролики (mode=`vcs`) показываются в галерее на `/create/vcs`
   (`fetchFinishedVcs`) и в общем разделе «AI монтаж → Готовые».

Ручной прогон из чата (без заявки): `node scripts/vcs-worker.mjs publish
--project <projectId> --video <mp4> --title "…"`.

## Компоненты

| Слой | Файл |
|------|------|
| Таблица очереди + `claim_vcs_job` | `supabase/migrations/20260730120000_vcs_jobs.sql` |
| Edge-функция воркера | `supabase/functions/vcs-worker/index.ts` |
| CLI-помощник очереди | `scripts/vcs-worker.mjs` |
| Очередь (фронт) | `src/lib/vcsQueue.ts` |
| Страница | `src/pages/CreateVcs.tsx` (роут `/create/vcs`) |
| Карточка в меню «Видео» | `src/components/factory/VideoContentGrid.tsx` |

Общая инфраструктура с монтаж-конвейером: bucket `renders`, ключ воркера
`montage_settings.worker_key`, привязка Telegram `telegram_links`, витрина
готовых `heygen_usage`.

## Деплой

```bash
# миграция
supabase db push          # или applied через Supabase MCP apply_migration
# edge-функция (verify_jwt выключен — воркер ходит не от пользователя)
supabase functions deploy vcs-worker --no-verify-jwt
```

Секреты, которые читает edge-функция: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`TELEGRAM_BOT_TOKEN` (для доставки в Telegram). Ключи ElevenLabs/Google живут на
стороне рендер-сессии video-creative-system (в её `.env`/секретах), в MarkVision
не хранятся.
