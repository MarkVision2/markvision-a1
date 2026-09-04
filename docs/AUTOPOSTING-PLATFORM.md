# Платформа автопостинга: что реализовано

Реализация плана `docs/AUTOPOSTING-PLATFORM-PLAN.md`: радар идей → генерация с вариантами →
согласование → дистрибуция на 100+ аккаунтов → метрики обратно в радар. Здесь — что именно
лежит в коде, контракты, переменные окружения, деплой, runbook. Контент-конвейер сам по себе
описан в `docs/CONTENT-PIPELINE.md`, базовая система публикации — в `docs/PUBLISHING-SYSTEM.md`.

```
Радар (radar) ──идея──▶ content_plan_items ──конвейер──▶ approved ──▶ publish_videos
   ▲                     × варианты по группам                          │ plan_publish_slots
   │                     (персона группы)                               ▼
post_metrics ◀──── publish-metrics ◀──── publish_jobs ◀──── claim (партиции) ◀── publish-worker ×3
```

## Что где

| Часть | Файлы |
|---|---|
| Схема радара | `supabase/migrations/20260905100000_radar.sql` — `radar_sources`, `radar_posts`, `radar_runs`, `idea_bank`, `radar_post_score()`, `radar_recompute_post()`, `radar_due_sources()`, витрина `radar_metrics`, крон `radar-maintenance` |
| Схема дистрибуции и связки | `supabase/migrations/20260905110000_publishing_scale.sql` — `personas`, колонки `content_plan_items` (`parent_item_id`, `target_group_id`, `persona_id`, `engine`, `idea_id`, `publish_video_id`), колонки групп и аккаунтов, `publish_slots` + `publish_next_slot()` + `plan_publish_slots()`, `claim_publish_jobs` v2 (счётчики, здоровье, партиции), `post_metrics` + `post_metrics_due()` + `idea_recompute_outcomes()`, `publish_project_settings`, `project_budgets` + `usage_ledger` + `project_budget_ok()`, витрина `publish_metrics`, `radar_promote_idea()`, `claim_next_content_job` с фильтром по движку, кроны |
| Радар | `supabase/functions/radar/index.ts`, чистая логика `supabase/functions/_lib/radar.ts` |
| Конвейер: варианты, персоны, автопередача | `supabase/functions/content-pipeline/index.ts` (маршрут `/items/:id/variants`, `handoffToPublishing`, автоодобрение доверенных групп) |
| Дистрибуция | `publish-intake` (планировщик слотов, стратегия группы), `publish-worker` (партиции), `_lib/publishers/threads.ts`, `publish-monitor` (обновление токенов, дайджест), `publish-metrics` (новая), `publish-accounts` (персоны, настройки, задания, Threads, «залить в группу»), `_lib/publishRunner.ts` (режим уведомлений) |
| Интерфейс | `src/pages/Radar.tsx` + `src/lib/radarClient.ts` + `src/hooks/useRadar.ts`; `src/pages/Publishing.tsx` + `src/lib/publishingClient.ts` + `src/hooks/usePublishing.ts`; блок вариантов в `src/components/content-plan/ContentPipelinePanel.tsx` |
| n8n | `docs/n8n-radar-crawler-v2.json` (сборщик), `docs/n8n-content-pipeline-v5.json` (claim с `engine: heygen`), существующий «🚀 Система автопостинга» без изменений |
| Диагностика | `scripts/content-pipeline-smoke.mjs doctor` проверяет radar / publish-metrics / publish-* ; `scripts/publishing-doctor.mjs` |
| Тесты | `src/test/radar.test.ts`, `src/test/radarPage.test.tsx`, `src/test/radarClient.test.ts`, `src/test/publishingPage.test.tsx`, `src/test/publishingClient.test.ts`, `src/test/contentPipelinePanel.test.tsx`; SQL-симуляция 100 аккаунтов — раздел «Проверено» |

## M1. Радар

Источники (`radar_sources`): аккаунт конкурента, хештег, запрос Ad Library, собственный аккаунт;
интервал сбора по источнику. Сборщик — n8n «Radar · сборщик v2»: Apify (instagram-scraper,
clockworks tiktok-scraper) с токеном в заголовке, ScrapeCreators для одиночных ссылок; результат
уходит подписанным вызовом в `POST /radar/internal/ingest` (HMAC как у контент-конвейера, секрет
`RADAR_CALLBACK_SECRET`, иначе `CONTENT_PIPELINE_CALLBACK_SECRET`). Нормализация полей любого
провайдера — `normalizeIngestItem` (единый источник правды, покрыт тестами).

Разбор делает сама edge-функция по крону `radar-maintenance` (каждые 15 минут, до 8 постов за
тик): Whisper по `video_url` (https, не приватные хосты, ≤ 25 МБ) → LLM по JSON-схеме
(`hook`, `structure`, `triggers`, `niche`, `score`, `idea_title`, `idea_angle`,
`script_outline`) через `_lib/aiProvider.ts` → `radar_recompute_post()`: engagement rate,
скорость, оценка `radar_post_score()` (насыщение около 5 % ER, 200 взаимодействий/час, оценка
модели даёт половину веса). Пост с оценкой ≥ 55 становится идеей в `idea_bank`. Бюджет проекта
(`project_budget_ok`) проверяется перед каждым разбором и сбором.

«В контент-план» — `radar_promote_idea(idea, group, persona, engine)`: тема REELS в `idea` с
хуком/углом/структурой в `prompts`, группой и персоной; идемпотентно. Дальше работает
контент-конвейер, а после публикации `idea_recompute_outcomes()` пишет `outcome_score`.

## M2. Варианты и передача в публикацию

Персона (`personas`) — tone of voice, ниша, запреты, язык, аватар/голос HeyGen, голос
ElevenLabs, тема Reels, движок по умолчанию. Группа аккаунтов ссылается на персону.

`POST /content-pipeline/items/:id/variants { group_ids }` создаёт дочерние темы
(`parent_item_id`, `target_group_id`, `persona_id`, `engine`); уникальный индекс не даёт
завести второй вариант на группу. Каждый вариант — обычная тема конвейера: `claim` подмешивает
персону в промпт (tone of voice, запреты, ниша, язык) и отдаёт n8n аватар/голос персоны.
Очередь фильтруется по движку (`claim_next_content_job(..., p_engine)`): n8n v5 берёт только
`heygen`; `reels_faceless` и `montage` ждут своих воркеров.

После `approved` (кнопка, Telegram или автоодобрение) `handoffToPublishing` создаёт
`publish_videos` (`source = content_pipeline`, `source_ref = content_asset_id`, подпись и
хештеги из сценария) и вызывает `plan_publish_slots` по целевой группе. Группа в режиме
`auto_publish` после `auto_publish_after` одобрений подряд (`approved_streak`) минует ворота;
отклонение сбрасывает серию.

## M3. Дистрибуция 100+

**Планировщик слотов** (`plan_publish_slots(video, group, account_ids, start, mode)`): темп
группы `per_hour` курсором, для каждого аккаунта `publish_next_slot()` — окно публикаций в поясе
аккаунта/группы, минимальный интервал от последнего слота или публикации, дневной лимит с
разгоном (`publish_account_effective_limit`: 1/день первые 7 дней → 2 → 3 → `daily_limit`),
джиттер вперёд. Слоты в `publish_slots` (unique по аккаунту и времени). `publish-intake`
пользуется им по умолчанию; стратегия и темп берутся из группы, если в `target` их нет;
`target.plan = "legacy"` возвращает старую раскладку по индексу; `mode = "now"` как раньше.

**Очередь**: `claim_publish_jobs(batch, lock_timeout, partition, partitions)` — счётчик
`published_today`/`published_day` вместо коррелированного подсчёта, здоровье ≥ 20, группа не
на паузе, партиция по `hashtext(account_id)`. pg_cron запускает `publish-worker` в три партиции
ежеминутно (`publish-worker-p0..p2`, batch 25). Триггер `publish_jobs_account_bookkeeping`
ведёт счётчики, `last_post_at` и здоровье (+1 успех, −10 отказ, −3 повтор после сбоя);
статусы `token_expired` / `limited` / `error` снимают 40 / 15 / 25.

**Threads** — `_lib/publishers/threads.ts`: контейнер → `FINISHED` → `threads_publish`,
текст до 500 символов, классификация отказов как у Instagram. Подключение —
`publish-accounts { action: "connect_threads", threads_user_id, access_token }` (токен
проверяется запросом к графу до сохранения; Threads OAuth — отдельное приложение Meta, в этой
версии токен вводится оператором).

**Токены**: `publish-monitor mode:tokens` за 10 дней до истечения обновляет long-lived токены
Instagram Login (`IG…`) и Threads через `refresh_access_token`; page-токены Facebook не
истекают. **Дайджест**: `mode:digest` раз в час — один отчёт на проект (опубликовано / упало с
кодами / повторы / ручной разбор / аккаунты, требующие внимания). Поштучные сообщения runner
шлёт только при `publish_project_settings.notify_mode = each`.

## M4. Управление

`publish_account_groups.review_mode`: `review_required` | `auto_publish` | `paused` (пауза
останавливает и планирование, и забор). `publish_project_settings`: режим уведомлений.
`project_budgets` (день/месяц, USD) + `usage_ledger` (единый журнал: OpenAI, HeyGen, Apify,
ScrapeCreators, Whisper, LLM); расход контент-конвейера зеркалится триггером из
`pipeline_runs.cost_usd`. `project_budget_ok()` проверяют радар (разбор и сбор) и очередь
конвейера. Аварийный стоп группы — `review_mode = paused`.

## M5. Аналитика

`publish-metrics` (крон каждые 6 часов): `post_metrics_due()` отдаёт публикации с наступившей
точкой d1 / d3 / d7; insights Instagram (`reach, views, likes, comments, shares, saved`) и Threads
(`views, likes, replies, reposts, quotes, shares`) → `post_metrics`; подписчики аккаунта раз в
сутки → `publish_accounts.followers`. Затем `idea_recompute_outcomes()`: медиана `reach /
followers` по d3–d7, 5 % ≈ 100 → `idea_bank.outcome_score`. Витрины `publish_metrics` и
`radar_metrics` — на страницах «Публикации» и «Радар идей».

## Endpoint'ы (новое)

| Вызов | Кто | Что |
|---|---|---|
| `GET /radar?project_id` | JWT | источники, витрина, идеи, лучшие посты, группы, сборы |
| `POST /radar/sources`, `/sources/:id/delete`, `/sources/:id/crawl` | JWT | источники; upsert сразу пинает сборщик |
| `POST /radar/analyze-url` | JWT | одна ссылка через n8n (`mode: url`) |
| `POST /radar/posts/:id/analyze` | JWT | повторный разбор поста |
| `POST /radar/ideas/:id`, `/ideas/:id/promote` | JWT | статус/правка идеи; идея → тема контент-плана |
| `POST /radar/internal/ingest` | HMAC | посты от сборщика |
| `POST /radar/maintenance` | `x-automation-key` | разбор, сбор по расписанию, GC |
| `POST /content-pipeline/items/:id/variants` | JWT | варианты темы под группы |
| `POST /publish-accounts` `connect_threads`, `persona_*`, `settings_get/upsert`, `jobs_list`, `metrics`, `publish_video` | JWT / ключ | см. шапку функции |
| `POST /publish-worker { partition, partitions }` | ключ | партиция воркера |
| `POST /publish-monitor { mode: "digest" }` | ключ | часовой дайджест |
| `POST /publish-metrics` | ключ | сбор метрик публикаций |

Контракты вебхуков `publishing-video-ready` / `publishing-create-jobs` для воркфлоу «🚀 Система
автопостинга» не изменились; `target.group_id` теперь дополнительно даёт стратегию и темп группы.

## Переменные окружения (новое)

| Где | Переменная | Назначение |
|---|---|---|
| Edge secrets | `RADAR_CALLBACK_SECRET` | HMAC ingest радара (иначе используется `CONTENT_PIPELINE_CALLBACK_SECRET`) |
| Edge secrets | `N8N_RADAR_WEBHOOK_URL`, `N8N_RADAR_WEBHOOK_KEY` | `https://n8n.zapoinov.com/webhook/radar-crawl` и `x-pipeline-key` |
| Edge secrets | `OPENAI_API_KEY` (или `LOVABLE_API_KEY`) | Whisper и LLM-разбор радара через `_lib/aiProvider.ts` |
| n8n «Настройки» сборщика | `webhook_key`, `apify_token`, `scrapecreators_key` | токен Apify в заголовке, не в URL |
| n8n под-воркфлоу callback (копия для радара) | `callback_url` = `…/functions/v1/radar/internal/ingest`, `callback_secret` | подпись ingest |

Остальное — как в `docs/CONTENT-PIPELINE.md` и `docs/PUBLISHING-SYSTEM.md`.

## Деплой

1. Влить ветку в `main`: миграции `20260905100000_radar.sql`, `20260905110000_publishing_scale.sql`
   и функции `radar`, `publish-metrics`, обновлённые `content-pipeline`, `publish-*` выкатит
   `supabase-deploy.yml`. Миграции идемпотентны, применяются после `20260904120000`.
2. Секреты edge-функций из таблицы выше.
3. n8n: импортировать `docs/n8n-radar-crawler-v2.json`; сделать копию под-воркфлоу «Content
   Pipeline · callback» с `callback_url` на `radar/internal/ingest` и подставить её ID в ноды
   «ingest»; переимпортировать `docs/n8n-content-pipeline-v5.json` (claim теперь передаёт
   `engine`). **Выключить старый «Мониторинг конкурентов» и ротировать Apify-токен**, который
   был захардкожен в URL его нод.
4. `node scripts/content-pipeline-smoke.mjs doctor --key <cron_secret>` — все функции и
   миграции на месте.
5. В интерфейсе: «Публикации» → персоны → группы (персона, окно, темп, режим) → аккаунты
   в группы; «Радар идей» → источники. Первый цикл: идея → «В контент-план → группа» →
   согласование → слоты.

Откат: выключить кроны `publish-worker-p0..p2` и вернуть `publish-worker-minutely`
(`cron.schedule` из `20260901160000`), `target.plan = "legacy"` в n8n-заявках; таблицы радара и
персон не мешают старому поведению.

## Runbook (дополнение)

| Симптом | Где смотреть | Действие |
|---|---|---|
| Посты не разбираются | `radar_posts.analysis_status = failed/skipped`, `error`; `radar_metrics.posts_unanalyzed` | `skipped` = бюджет; `failed` = ошибка провайдера (текст в `error`); `POST /radar/posts/:id/analyze` |
| Источник не собирается | `radar_sources.last_crawled_at`, `last_error`; `radar_runs` | сборщик n8n включён? `N8N_RADAR_WEBHOOK_URL/KEY`; Apify-лимиты |
| Идея не стала темой | `idea_bank.status`, `content_item_id` | `radar_promote_idea` идемпотентна: повторный вызов вернёт ту же тему |
| Вариант не рендерится | `content_plan_items.engine`, `personas.engine_default` | n8n v5 берёт только `heygen`; для `reels_faceless` нужен Reels-воркер |
| Одобрено, но публикаций нет | `pipeline_runs.metadata.handoff`, `content_plan_items.publish_video_id`, `target_group_id` | без группы видео попадает только в библиотеку; группа `paused` не планируется |
| Слоты далеко в будущем | `publish_slots`, окно/интервал группы, `ramp_started_at`, `daily_limit` | разгон: 1/день первую неделю; `ramp_enabled = false` или `ramp_restart` |
| Аккаунт не берётся очередью | `health_score < 20`, `published_today` ≥ лимита, `review_mode = paused` | вернуть здоровье: статус `active` поднимает до 50 |
| Воркер «не успевает» | `publish_metrics.jobs_queued`, `next_slot_at` | партиций 3 по 25 в минуту = 75/мин; при росте — добавить кроны `publish-worker-p3…` с `partitions = N` |
| Нет дайджеста | `publish_project_settings.notify_mode`, `telegram_links` | дайджест молчит, если сбоев за час не было |
| Метрик нет через 3 дня | `post_metrics_due()`, токен аккаунта, `publish_jobs.external_post_id` | `publish-metrics` вручную с ключом; insights недоступны для части типов медиа — берётся `reach` |

## Проверено

Локальный Postgres 16 со стабами, обе миграции применены дважды (идемпотентность), симуляция
100 аккаунтов в 10 группах (`/tmp` сценарий из сессии, воспроизводится по разделу «Схема»):

- план 10 аккаунтов группы: 10 слотов с шагом 6 минут (per_hour 10), повтор — 0 новых;
- старт в 23:30 Алматы → все слоты в 09:00 следующего дня;
- второе видео в день для аккаунтов с разгоном (лимит 1) уходит на завтра;
- ни одной пары слотов ближе 120 минут;
- три партиции claim не пересекаются и в сумме забирают все 30 due-заданий;
- учёт публикации: `published_today`, `last_post_at`, здоровье; исчерпанный лимит — очередь аккаунт не отдаёт;
- `token_expired` −40 здоровья; витрина `publish_metrics`;
- `radar_post_score(0.05, 100, null) = 78.3`, `(0.05, 100, 90) = 84.2`; `radar_promote_idea` идемпотентна;
- расход конвейера зеркалится в `usage_ledger`, `project_budget_ok` считает день и месяц.

Edge-функции проходят строгий tsc с типами supabase-js; vitest — чистая логика радара и Threads.
Не выполнялось из этой среды: боевой сбор через Apify, реальные публикации в Threads,
обновление токенов на живых аккаунтах — это этап пилота (`smoke e2e`, `publishing-doctor`).

## Что осталось за рамками

- TikTok и YouTube publishers (аудит приложения / квота) — заглушки с контрактом.
- Threads OAuth-поток (сейчас токен вводится оператором).
- Reels faceless и монтаж как воркеры очереди конвейера (сейчас темы с этими движками ждут).
- Дашборд «Сеть» с графиками по группам: цифры есть в витринах, страница показывает плитки.
- Нагрузочный тест на живых площадках (этап 5).
