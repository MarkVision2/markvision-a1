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
| Радар | `supabase/functions/radar/index.ts`, чистая логика `supabase/functions/_lib/radar.ts` (нормализация, разбор), `supabase/functions/_lib/radarCrawl.ts` (прямой сборщик Apify: акторы, вход, разворачивание ответа, стоимость); миграция `20260907110000_radar_crawler.sql` (статус и id запуска в `radar_runs`) |
| Конвейер: варианты, персоны, автопередача | `supabase/functions/content-pipeline/index.ts` (маршрут `/items/:id/variants`, `handoffToPublishing`, автоодобрение доверенных групп) |
| Дистрибуция | `publish-intake` (планировщик слотов, стратегия группы), `publish-worker` (партиции), `_lib/publishers/threads.ts`, `publish-monitor` (обновление токенов, дайджест), `publish-metrics` (новая), `publish-accounts` (персоны, настройки, задания, Threads, «залить в группу»), `_lib/publishRunner.ts` (режим уведомлений) |
| Интерфейс | `src/pages/Radar.tsx` + `src/lib/radarClient.ts` + `src/hooks/useRadar.ts`; `src/pages/Publishing.tsx` + `src/lib/publishingClient.ts` + `src/hooks/usePublishing.ts`; блок вариантов в `src/components/content-plan/ContentPipelinePanel.tsx` |
| n8n | `docs/n8n-radar-crawler-v2.json` (сборщик), `docs/n8n-content-pipeline-v5.json` (claim с `engine: heygen`), существующий «🚀 Система автопостинга» без изменений |
| Диагностика | `scripts/content-pipeline-smoke.mjs doctor` проверяет radar / publish-metrics / publish-* ; `scripts/publishing-doctor.mjs` |
| Воркер Reels faceless | `scripts/content-pipeline-worker.mjs` (claim по движку → OpenAI → reels_jobs → asset) |
| OAuth площадок | `supabase/functions/publish-oauth/index.ts`, чистая логика `_lib/publishOAuth.ts`, миграция `20260905120000_publish_oauth.sql` |
| Тесты | `src/test/radar.test.ts`, `src/test/radarPage.test.tsx`, `src/test/radarClient.test.ts`, `src/test/publishingPage.test.tsx`, `src/test/publishingClient.test.ts`, `src/test/contentPipelinePanel.test.tsx`; SQL-симуляция 100 аккаунтов — раздел «Проверено» |

## M1. Радар

Источники (`radar_sources`): аккаунт конкурента, хештег, запрос Ad Library, собственный аккаунт;
интервал сбора по источнику.

**Сборщик — прямой Apify из edge-функции** (секрет `APIFY_TOKEN`, чистая логика
`_lib/radarCrawl.ts`): актор по площадке — `apify~instagram-scraper` (аккаунт → `details`:
профиль с подписчиками и последними постами одним запуском; хештег → `posts`; ссылка на
`/p/`, `/reel/`), `clockworks~tiktok-scraper` (`profiles` / `hashtags` / `postURLs`),
`streamers~youtube-scraper` (канал `@ник` или `UC…` → shorts + videos; хештег → `/hashtag/…`;
ссылка на видео), `thenetaji~threads-scraper` (профиль / ссылка на пост Threads),
`apify~facebook-posts-scraper` (страница Facebook по нику или ссылке / ссылка на пост),
`apify~facebook-ads-scraper` (источник «Библиотека рекламы»: запрос → поисковая ссылка Ad Library
по всем странам, для площадки Instagram — только объявления Instagram; готовая ссылка на страницу
или Ad Library — как есть; у объявлений нет реакций, поэтому оценка поста = оценка модели).
Запуск асинхронный: `POST /acts/{actor}/runs` → строка `radar_runs` со `status = running`
и `external_id` (id запуска). Результат дособирается в `syncRuns()`: при `GET /radar`
(обзор, до 6 запусков — поэтому «Обновить» и опрос страницы показывают посты, не дожидаясь
крона) и по крону `radar-maintenance` (до 20). Успех → элементы датасета →
`flattenApifyItems()` → `normalizeIngestItem()` → `radar_posts` + `radar_recompute_post()`,
стоимость по тарифу актора → `radar_runs.cost_usd` и `usage_ledger` (`engine = apify`).
Пустой результат → `failed` с текстом («аккаунт закрыт или ник неверный»), зависший запуск
(> 20 минут) закрывается ошибкой. Один источник/ссылка не запускается второй раз, пока
первый работает. Не поддерживаются хештеги Threads и Facebook и «Библиотека рекламы» вне
Facebook/Instagram — источник получает `last_error` с причиной. Форматы ответов Threads и
Facebook-акторов сопоставлены по полям GraphQL/актора с запасными ключами
(`flattenApifyItems`), боевой прогон по ним не делался (лимит Apify) — при пустых постах
смотреть `radar_posts.raw` первого удачного сбора.

Запасной сборщик — n8n «Radar · сборщик v2» (`N8N_RADAR_WEBHOOK_URL`), используется только
если `APIFY_TOKEN` не задан: результат уходит подписанным вызовом в
`POST /radar/internal/ingest` (HMAC как у контент-конвейера, секрет `RADAR_CALLBACK_SECRET`,
иначе `CONTENT_PIPELINE_CALLBACK_SECRET`). Нормализация полей любого провайдера —
`normalizeIngestItem` (единый источник правды, покрыт тестами).

Разбор делает сама edge-функция по крону `radar-maintenance` (каждые 15 минут, до 8 постов за
тик) и фоном после `GET /radar` (до 2 постов в очереди — так разбор ссылки не ждёт крона): Whisper по `video_url` (https, не приватные хосты, ≤ 25 МБ) → LLM по JSON-схеме
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
`heygen`; `reels_faceless` забирает `scripts/content-pipeline-worker.mjs` (тот же подписанный
callback-протокол: сценарий OpenAI → заявка в `reels_jobs` с голосом и темой персоны →
ожидание рендера Reels-очереди → `video_status` → `asset`; рендер Remotion уже 1080×1920, поэтому
FFmpeg-воркер не нужен); `montage` ждёт своего воркера.

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

**Publishers всех четырёх площадок** (`_lib/publishers/`):
Instagram и Threads — контейнер → `FINISHED` → publish (Threads: текст до 500 символов);
TikTok (`tiktok.ts`) — Content Posting API Direct Post: `creator_info/query` выбирает
публичный `privacy_level`, если он доступен аккаунту, `video/init` с `PULL_FROM_URL`
(домен видео должен быть верифицирован в приложении TikTok), опрос `status/fetch` до
`PUBLISH_COMPLETE`, `publish_id` = containerId; неаудированное приложение получает понятный
fatal, а не повторы. YouTube (`youtube.ts`) — Data API v3 `videos.insert` resumable upload:
файл скачивается с `file_url` и заливается потоком (без Content-Length — буфер до 200 МБ),
адрес сессии = containerId (повтор продолжает сессию), `quotaExceeded` /
`uploadLimitExceeded` → `limit`; приватность — `YOUTUBE_PRIVACY_STATUS` (по умолчанию
public). Классификация отказов всех площадок покрыта тестами.

**Подключение аккаунтов**: Instagram — Meta OAuth (`publish-accounts available/connect`);
Threads, TikTok, YouTube — edge-функция `publish-oauth` (`POST /start` → ссылка на согласие,
`GET /callback/:platform` → обмен кода, long-lived токен Threads, идентичность аккаунта,
шифрование токенов, `oauth_scope`, редирект обратно с `?publish_connected=`). Одноразовый
state — `publish_oauth_states` (миграция `20260905120000_publish_oauth.sql`, TTL 15 мин).
**TikTok: «Что-то пошло не так — client_key» после входа.** Это не про значение ключа.
Пока приложение не Live (не прошло App review), авторизоваться через него могут только
**target users** песочницы; любой другой аккаунт TikTok после входа получает эту страницу.
Production-ключ (`aw…`) заработает для всех только после одобрения. До этого — Sandbox:
Manage apps → переключатель Sandbox → Create Sandbox → добавить продукты Login Kit и
Content Posting API → Target users → Add account (до 10) → sandbox Client Key (`sbaw…`) и
Secret → в `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` → redirect_uri в Login Kit песочницы.
Sandbox не публикует публичные видео — для боевой публикации нужен App review.
Проверка без входа: `GET /publish-oauth/diag` (JWT или `x-automation-key`) — что задано,
были ли пробелы в секретах, redirect_uri для регистрации.

Кнопки «Подключить Threads / TikTok / YouTube» — на странице «Публикации»; ручной ввод
токена Threads оставлен как запасной путь.

**Токены**: короткоживущие токены (TikTok — сутки, YouTube — час) `publishRunner.ensureFreshToken`
обновляет `refresh_token`'ом прямо перед публикацией; Threads и Instagram Login (`IG…`) —
long-lived, обновляются за 10 дней до истечения (`publish-monitor mode:tokens`, где для
TikTok/YouTube живость = успешное обновление); page-токены Facebook не истекают. **Дайджест**: `mode:digest` раз в час — один отчёт на проект (опубликовано / упало с
кодами / повторы / ручной разбор / аккаунты, требующие внимания) — в чат
`publish_project_settings.digest_chat_id`, если задан, иначе в чат проекта из `telegram_links`.
Поштучные сообщения runner шлёт только при `publish_project_settings.notify_mode = each`.

## M4. Управление

`publish_account_groups.review_mode`: `review_required` | `auto_publish` | `paused` (пауза
останавливает и планирование, и забор). `publish_project_settings`: режим уведомлений, чат
дайджеста и **аварийная пауза проекта** `paused` — `claim_publish_jobs` не отдаёт задания,
`plan_publish_slots` не ставит слоты, очередь сохраняется; рубильник во вкладке «Настройки»
страницы «Публикации» (`settings_upsert { paused }`), баннер на странице и флаг в `publish_metrics`.
Цель темы до генерации меняется в карточке («Цель и движок»): `POST /content-pipeline/items/:id/settings
{ target_group_id?, persona_id?, engine? }` — группа подтягивает свою персону, персона — движок по
умолчанию; во время активного запуска — 409.
`project_budgets` (день/месяц, USD) + `usage_ledger` (единый журнал: OpenAI, HeyGen, Apify,
ScrapeCreators, Whisper, LLM); расход контент-конвейера зеркалится триггером из
`pipeline_runs.cost_usd`. `project_budget_ok()` проверяют радар (разбор и сбор) и очередь
конвейера. Аварийный стоп группы — `review_mode = paused`.

## M5. Аналитика

`publish-metrics` (крон каждые 6 часов): `post_metrics_due()` отдаёт публикации с наступившей
точкой d1 / d3 / d7; статистика площадки → `post_metrics`: Instagram insights (`reach, views,
likes, comments, shares, saved`), Threads (`views, likes, replies, reposts, quotes, shares`),
TikTok `POST /v2/video/query/` (`view/like/comment/share_count`; нужен scope `video.list` —
входит в `SCOPES.tiktok`, аккаунты, подключённые без него, помечаются в ответе `reasons` как
требующие reconnect), YouTube `videos?part=statistics` (`viewCount, likeCount, commentCount`).
Перед сбором токен обновляется тем же `ensureFreshToken`, что и у воркера. Пост, которого для
нашего токена больше нет (Graph «Unsupported get request … does not exist / missing permissions»,
TikTok/YouTube «видео не найдено» — `metricsErrorPermanent` в `_lib/publishMetricsCore.ts`),
получает `publish_jobs.metrics_unavailable_reason` и выпадает из `post_metrics_due` по всем
точкам (ответ функции — `unavailable`, во вкладке «Задания» — «без метрик»); reconnect аккаунта
через `publish-oauth` пометку снимает. Временные отказы (лимит, токен) пробуются снова. Подписчики аккаунта
раз в сутки → `publish_accounts.followers` (TikTok `user/info follower_count`, YouTube
`channels statistics.subscriberCount`). Затем `idea_recompute_outcomes()`: медиана `reach /
followers` по d3–d7, 5 % ≈ 100 → `idea_bank.outcome_score`.

**Лента своих публикаций в радар**: на точке d3 каждый свой ролик кладётся в `radar_posts`
(источник `radar_sources.kind = own_account` с тем же handle, если заведён; иначе без источника)
с метриками и `radar_recompute_post()`; на разбор LLM (`analysis_status = pending`) уходят только
хиты — охват ≥ 5 % подписчиков или ≥ 10 000 просмотров (`_lib/publishMetricsCore.ts`), остальные
`skipped`. Так банк идей учится и на своих результатах.

Витрины: `publish_metrics` (проект, включая `paused`), `publish_group_metrics` (по группе:
состав, активные, `health_avg`, очередь, публикаций/ошибок за 7 дней, `reach_d3_7d`, ближайший
слот, одобренных тем) — сводка во вкладке «Группы» на странице «Публикации»; `radar_metrics` — «Радар идей».

`publish_account_metrics` — строка на подключённый аккаунт для вида **«Статистика»** во вкладке «Аккаунты»:
посты (всего / за 30 дней), очередь и ошибки, показы, комментарии, ER и подписчики, статус
и скоринг здоровья. Приходит в `metrics.accounts`. Охват считается по **последней снятой
контрольной точке каждого поста** (d7 > d3 > d1): точки кумулятивны, суммировать их подряд —
значит посчитать один просмотр трижды. Пока метрик по посту нет, колонки честно пустые
(`—` и «ждём метрики: N»), а не нулевые.

## TikTok: FILE_UPLOAD вместо PULL_FROM_URL, короткие токены без штрафа

Публикатор TikTok заливает ролик сам (`FILE_UPLOAD`: init → PUT кусков на
`upload_url` → опрос статуса), а не отдаёт площадке ссылку. Причина: для
`PULL_FROM_URL` TikTok требует верифицировать домен видео в приложении, а ролики
лежат на `supabase.co` и `r2.cloudflarestorage.com` — чужие домены, их
верифицировать нельзя, `url_ownership_unverified` был бы навсегда. Куски — по
правилам площадки (`planTikTokChunks`, тесты `src/test/publishTiktokUpload.test.ts`):
до 64 МБ одним куском, дальше по 32 МБ с хвостом в последнем; байты идут
Range-запросами с исходника, целиком не буферизуются.

Скоринг здоровья не штрафует TikTok и YouTube за «токен истекает через N ч»:
их access-token короткий по замыслу (24 ч и 1 ч), монитор продлевает его
refresh-токеном сам. Штраф оставался бы вечным (здоровье 65 у здорового
аккаунта). Настоящий сигнал у них — провал обновления, это `token_expired`.

## Аудит готовности (05.09.2026) — что закрыто и что осталось

Прогон по живому проекту: 14 Instagram-аккаунтов (13 в «MarkVision AI», 1 в «Адал Есеп Бух»),
все токены живые, Telegram привязан, кроны ходят (health-6h отметился в 00:40 UTC),
4 задания в истории: 1 опубликовано, 3 упали на тестовых `example.com`-ссылках.

**Закрыто аудитом:**

* `r2-presign-upload` не была объявлена в `config.toml` → шлюз требовал JWT и отвечал
  `UNAUTHORIZED_NO_AUTH_HEADER`: заливка видео **больше 45 МБ** не работала ни в композере,
  ни в монтаже, ни в автопостинге. Объявлена `verify_jwt = false`, вызовы шлют
  `Authorization: Bearer <publishable>` на случай, если шлюз снова потребует.
* Задания нельзя было повторить или отменить из интерфейса — `job_retry` / `job_cancel`
  (`JOB_ACTIONS` на фронте зеркалит допустимые статусы; отмена освобождает слот).
* Композер не давал задать время старта — `start_at` (пусто = сейчас).
* Instagram Login-токен (`IG…`) с пустым `token_expires_at` монитор никогда не обновлял —
  через 60 дней аккаунт умер бы молча. Теперь обновляется сразу и срок записывается.
* Один Instagram в двух проектах (`adale_esep` — реальный случай) удваивает дневной лимит
  на один аккаунт площадки. `available` помечает `connected_elsewhere`, диалог предупреждает.

**Осталось — требует действий вне кода:**

* TikTok — Sandbox + target users, потом App review (см. выше).
* Threads — секреты `THREADS_APP_ID` / `THREADS_APP_SECRET` не заданы: кнопка «Threads»
  отвечает «не настроен»; путь «по токену» работает без приложения.
* YouTube — приложение настроено, аккаунтов пока нет; квота Data API по умолчанию
  ~6 загрузок/сутки, для сети нужен запрос на расширение.
* Ни одной группы и персоны: все 14 аккаунтов на дефолтах (разгон включён → первую неделю
  1 пост/день на аккаунт, окно и часовой пояс не заданы — планировщик берёт Asia/Almaty).

**Осталось — в коде, не блокирует:**

* Библиотека видео: `publish_video` принимает `video_id`, но интерфейс не даёт дозалить уже
  загруженный ролик в новые аккаунты.
* `caption_variants` (уникальная подпись на аккаунт) есть в API и раскладке, в композере нет.
* Обложка Reels (`cover_url`) поддержана публикатором, в композере нет.
* Автоматическая передача одобренного видео из конвейера контента в `publish_videos`.

## Аудит кода (05.09.2026, второй заход) — что закрыто

Три параллельных аудита (фронт, edge-функции, схема БД) по разделу «Публикации».
Закрыто миграцией `20260907100000_publishing_hardening.sql`, правками `publish-*`
и фронта:

**Безопасность.**
* `publish-accounts`: все id из тела (аккаунт, группа, видео, задание) обязаны принадлежать
  проекту запроса — раньше, назвав свой `project_id` и чужой `account_id`, можно было
  править, отключать и удалять чужие аккаунты и группы, а `publish_video` с чужим `video_id`
  раскладывал посты по чужой сети. `group_id` / `persona_id` в `update`, `connect_threads`,
  `group_upsert` проверяются; `persona_upsert` / `group_upsert` по `id` — только внутри проекта.
* `project_spend`, `project_budget_ok`, `publish_account_window` (SECURITY DEFINER) проверяют
  доступ к проекту (`publishing_caller_allowed`).
* Бакет `publish-uploads`: запись только `authenticated`, лимит 50 МБ (крупные файлы — R2).
  Прямые записи в `publish_project_settings` / `project_budgets` закрыты (только через функцию).
* `publish-accounts` объявлена в `config.toml` (`verify_jwt = false`, авторизацию делает
  сама) — иначе путь с `x-automation-key` (скрипты, n8n) отбрасывался шлюзом.

**Планировщик и очередь.**
* Пауза группы учитывается и при явном `account_ids` (раньше задания создавались, а
  `claim` их никогда не брал). Режим `now` не пишет фиктивный слот.
* Джиттер не выходит за окно публикаций; окно через полночь (`22:00–02:00`) у аккаунта
  работает; `publish_next_slot` — VOLATILE.
* `claim_publish_jobs` берёт на аккаунт не больше остатка дневного лимита за один забор
  (раньше разгоняемый аккаунт мог получить 25 заданий за минуту); `hashtext` без
  переполнения; `daily_limit = 0` = «не публиковать», API не даёт задать меньше 1.
* Слоты освобождаются при `failed` / `cancelled`.
* Триггер здоровья по статусу не перетирает `health_score`, записанный формулой тем же
  UPDATE; reconnect через OAuth ставит 100 с причиной.
* Витрины `publish_metrics` / `publish_group_metrics` / `publish_account_metrics` читаемы
  `authenticated`: выданы гранты на новые колонки `publish_accounts`, `publish_accounts_safe`
  расширено.

**Раннер и площадки.**
* Опрос обработки медиа считается в `publish_jobs.poll_count`, не ест попытки; после 30 опросов —
  `failed processing_timeout`. Отказы по токену/лимиту после `MAX_ATTEMPTS` уходят в
  `manual_review`, а не крутятся в `retry` вечно. `manual_review` уведомляет в режиме `each`.
* `job_retry` сбрасывает `attempts`, `container_id` и ставит `scheduled_at = now()`; зависший
  `processing` (аренда старше 10 мин) можно повторить/отменить из интерфейса.
* Токены в URL Graph/Threads кодируются (`Cannot parse access token` больше не гасит аккаунт).
* YouTube: `Authorization` на PUT и probe resumable-сессии. TikTok: отказы по файлу/ссылке —
  окончательные.
* `publish-monitor`: живость TikTok/YouTube — запросом «кто я», refresh только по сроку
  (раньше каждая проверка ротировала refresh_token); бюджет 45 с на прогон с отчётом
  `skipped`; `try/catch` на уровне обработчика у monitor / worker / metrics; после refresh
  срок токена обновляется в памяти (формула не считала свежий токен истёкшим).
* `publish-dispatch` не публикует задание, которое сейчас держит воркер.

**Фронт.**
* Композер: группа = состав и темп (автоотбор её годных участников, режим из стратегии
  группы), предпросмотр повторяет фильтры `plan_publish_slots` (членство, площадка, паузы);
  время старта — Алматы независимо от пояса браузера, `min` = сейчас; список аккаунтов в
  popover — тот же `AccountPicker` с поиском и пресетами; «Все» не сбрасывает чужой выбор;
  причина «создано 0» приходит с сервера (`reason`).
* Очистка полей группы и бюджета сохраняется (null → умолчание); лимит файла 2 ГБ до заливки;
  повтор PUT в R2 при обрыве сети; сброс данных при смене проекта; массовые правки без
  перечитывания после каждой строки; выделение действует только на видимые строки;
  чип «Внимание N»; фильтры вкладки «Аккаунты» переживают переключение вкладок;
  скелет загрузки; причины пропуска при подключении Instagram.
* Метрики (по итогам `content-pipeline-smoke.mjs doctor` на боевой базе): удалённый или
  недоступный токену пост опрашивался каждый прогон по трём точкам — теперь помечается
  `metrics_unavailable_reason` (миграция `20260907140000_post_metrics_unavailable.sql`),
  `post_metrics_due` его пропускает, reconnect аккаунта снимает пометку.
* Повторная публикация (миграция `20260907150000_publish_repost_video_stats.sql`): полная
  уникальность `(video_id, account_id)` в `publish_jobs` заменена частичной — не больше одного
  **активного** задания на пару (`pending/retry/processing/manual_review`); опубликованное,
  упавшее и отменённое второму заходу не мешают. `plan_publish_slots(..., p_repost)` без флага
  идемпотентна (у аккаунта уже есть задание с видео, кроме отменённого → вернёт его,
  `created = false`), с `p_repost = true` ставит новое. `publish-intake` проверяет существующие
  задания сам (без `upsert onConflict`), `job_retry` при активном новом задании отвечает 409.
  Витрина `publish_video_stats` (только service role) — задания по каждому видео.
* Вкладка **«Видео»**: библиотека роликов проекта со счётчиками заданий (опубликовано / в
  очереди / с ошибкой), «Опубликовать ещё» открывает композер без заливки файла (`video_id`,
  `repost: true`; правки текста сохраняются в карточку видео), «Задания» переключает на очередь
  с фильтром по видео. «Задания»: строка поиска (аккаунт, ник, видео, ошибка), чип фильтра по
  видео, «Показать ещё» до потолка сервера 500. Меню строки аккаунта: «Окно публикаций» —
  часовой пояс и часы слотов для конкретного аккаунта (пусто — как у группы), спиннер
  занятости только у той строки, чьё действие идёт.

## Здоровье аккаунта — как считается

`health_score` (0..100) — **детерминированная формула** из проверяемых фактов
(`supabase/functions/_lib/publishHealth.ts`, тесты `src/test/publishHealth.test.ts`),
а не счётчик «+1 за успех / −10 за отказ», который со временем показывал что угодно.
Причины кладутся в `publish_accounts.health_reasons` и видны в подсказке у числа.

| Факт | Эффект |
|---|---|
| токен не прошёл живую проверку / `token_expired` / срок истёк | потолок **15** — ниже порога планировщика (20) |
| статус `error` (погашен монитором) / `limited` | потолок 35 / 55 |
| выключен вручную (`disabled`) | 0 |
| токен истекает < 2 дн. / < 7 дн. | −35 / −15 |
| отказов подряд | −10 за каждый, не больше −40 |
| доля ошибок за 30 дн. (от 3 исходов) > 50 % / > 20 % | −30 / −15 |
| ни разу не проверялся / проверка старше 3 дн. | −10 |

**Кто проверяет.** `publish-monitor` `{mode: "health", project_id?, account_ids?}` —
живой запрос к площадке по каждому аккаунту (Instagram/Threads — `?fields=id` от
имени аккаунта, TikTok/YouTube — обновление refresh-токеном), затем пересчёт
формулой; мёртвый токен → `token_expired` + Telegram (один раз при переходе), оживший
`token_expired` → `active`. Пишет `last_checked_at`. Запускается кроном раз в 6 часов
(`publish-monitor-health-6h`) и кнопками в интерфейсе: «Проверить все» над таблицей,
«Проверить» в панели массовых действий, «Проверить сейчас» в меню строки. Суточный
`mode: "tokens"` тоже пересчитывает здоровье. Между проверками SQL-триггеры по-прежнему
двигают счётчик за успех/отказ — следующая проверка перезаписывает его формулой.

## Страница «Публикации»: вкладки и массовая заливка

Сверху — сводка одной полосой: активные аккаунты с разбивкой по площадкам (Instagram / TikTok /
YouTube / Threads, нули видны), очередь и ближайший слот, публикации и ошибки за сутки, здоровье
сети с числом аккаунтов, требующих внимания, расход. Дальше шесть вкладок:

| Вкладка | Что показывает |
|---|---|
| Аккаунты | один список, два вида. **Управление**: статус, группа, сегодня/лимит, здоровье, включение, меню редких настроек. **Статистика** (витрина `publish_account_metrics`): подписчики, посты (всего / 30 дн.), показы, комментарии, ER, здоровье, сортировка по колонкам и итоги. Общие для обоих видов: поиск, чипы площадок со счётчиками, фильтр по группе, чекбоксы + панель массовых действий, «Проверить все». Таблица прокручивается внутри себя с прилипшей шапкой |
| Группы | сводка по группам (`publish_group_metrics`) над настройками групп |
| Видео | библиотека роликов проекта (`publish_videos` + `publish_video_stats`): источник, задания (опубликовано / в очереди / с ошибкой), последний пост, ближайший слот; «Опубликовать ещё» — композер без заливки (`video_id`, `repost`), «Задания» — очередь с фильтром по видео |
| Задания | чипы статусов со счётчиками, поиск по аккаунту / видео / ошибке, чип фильтра по видео, «Показать ещё» (до 500), повтор и отмена; «без метрик» у постов, которых площадка больше не отдаёт |
| Персоны / Настройки | без изменений; в меню строки аккаунта — «Окно публикаций» (пояс и часы слотов аккаунта, пусто = как у группы) |

**«Залить видео»** — композер в две колонки (`components/publishing/UploadPublishDialog.tsx`):

* слева — полоса аккаунтов-чипов (`AccountChips`, негодные приглушены и не выбираются),
  заголовок, текст, ролик (drag&drop файла или готовая https-ссылка), хэштеги, режим и темп;
* справа — предпросмотр (`PostPreview`): как пост ляжет в ленту Instagram / TikTok / YouTube /
  Threads, с реальной обрезкой кадра по пропорции исходника;
* внизу — план: сколько заданий, шаг между аккаунтами, ориентировочный последний слот и кого
  планировщик пропустит.

Файл до 45 МБ уходит в bucket `publish-uploads`, крупнее — напрямую в R2 через
`r2-presign-upload` (Storage на Free-плане режет всё, что больше 50 МБ). Дальше — один вызов
`publish_video` с явным `account_ids`, задания раскладывает `plan_publish_slots`.

Годность аккаунта продублирована на фронте (`lib/publishingSelection.ts`) зеркалом WHERE из
`plan_publish_slots`: `status = 'active' AND publish_enabled AND health_score >= 20`. Расхождение
с SQL = оператор выбрал 40 аккаунтов, а заданий создалось 12 без объяснения причины.

## Endpoint'ы (новое)

| Вызов | Кто | Что |
|---|---|---|
| `GET /radar?project_id` | JWT | источники, витрина, идеи, лучшие посты, группы, сборы |
| `POST /radar/sources`, `/sources/:id/delete`, `/sources/:id/crawl` | JWT | источники; upsert сразу запускает сбор (`kicked`, `kick_error`, `run_id`); `crawl` отвечает 400 с причиной, если запуск невозможен, 402 — бюджет |
| `POST /radar/analyze-url` | JWT | одна ссылка Instagram / TikTok / YouTube → запуск Apify (`mode: url`), 400 с причиной |
| `POST /radar/posts/:id/analyze` | JWT | повторный разбор поста |
| `POST /radar/ideas/:id`, `/ideas/:id/promote` | JWT | статус/правка идеи; идея → тема контент-плана |
| `POST /radar/internal/ingest` | HMAC | посты от сборщика |
| `POST /radar/maintenance` | `x-automation-key` | разбор, сбор по расписанию, GC |
| `POST /content-pipeline/items/:id/variants` | JWT | варианты темы под группы |
| `POST /publish-accounts` `connect_threads`, `persona_*`, `settings_get/upsert`, `jobs_list`, `metrics`, `publish_video` | JWT / ключ | см. шапку функции |
| `POST /publish-worker { partition, partitions }` | ключ | партиция воркера |
| `POST /publish-monitor { mode: "digest" }` | ключ | часовой дайджест |
| `POST /publish-metrics` | ключ | сбор метрик публикаций (IG / Threads / TikTok / YouTube) + лента своих постов в радар |
| `POST /content-pipeline/items/:id/settings` | JWT | цель (группа), персона, движок темы до генерации |
| `POST /publish-oauth/start`, `GET /publish-oauth/callback/:platform` | JWT / state | OAuth Threads / TikTok / YouTube |

Контракты вебхуков `publishing-video-ready` / `publishing-create-jobs` для воркфлоу «🚀 Система
автопостинга» не изменились; `target.group_id` теперь дополнительно даёт стратегию и темп группы.

## Переменные окружения (новое)

| Где | Переменная | Назначение |
|---|---|---|
| Edge secrets | `APIFY_TOKEN` | прямой сборщик радара (Instagram / TikTok / YouTube); токен аккаунта Apify (`https://console.apify.com/settings/integrations`) |
| Edge secrets | `RADAR_CALLBACK_SECRET` | HMAC ingest радара от n8n (иначе используется `CONTENT_PIPELINE_CALLBACK_SECRET`) — нужен только для запасного сборщика |
| Edge secrets | `N8N_RADAR_WEBHOOK_URL`, `N8N_RADAR_WEBHOOK_KEY` | запасной n8n-сборщик, используется только без `APIFY_TOKEN` |
| Edge secrets | `OPENAI_API_KEY` (или `LOVABLE_API_KEY`) | Whisper и LLM-разбор радара через `_lib/aiProvider.ts` |
| Edge secrets | `THREADS_APP_ID`, `THREADS_APP_SECRET` | приложение Meta с Threads API (redirect URI: `…/functions/v1/publish-oauth/callback/threads`) |
| Edge secrets | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | приложение TikTok for Developers (Login Kit + Content Posting API; redirect URI `…/callback/tiktok`; верифицировать домен видео) |
| Edge secrets | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | тот же клиент, что у Google Ads; включить YouTube Data API v3, добавить redirect URI `…/callback/youtube` |
| Edge secrets | `YOUTUBE_PRIVACY_STATUS` | `public` (по умолчанию) / `unlisted` / `private` |
| VPS `.env` воркера Reels | `SUPABASE_SERVICE_ROLE_KEY`, `CONTENT_PIPELINE_CALLBACK_SECRET`, `OPENAI_API_KEY`, `REELS_DEFAULT_VOICE` | `scripts/content-pipeline-worker.mjs` |
| n8n «Настройки» сборщика | `webhook_key`, `apify_token`, `scrapecreators_key` | токен Apify в заголовке, не в URL |
| n8n под-воркфлоу callback (копия для радара) | `callback_url` = `…/functions/v1/radar/internal/ingest`, `callback_secret` | подпись ingest |

Остальное — как в `docs/CONTENT-PIPELINE.md` и `docs/PUBLISHING-SYSTEM.md`.

## Деплой

Состояние: 2026-09-04 ветка влита в `main`, GitHub Actions `supabase-deploy` применил миграции
`20260904120000`, `20260905100000`, `20260905110000`, `20260905120000` и выкатил edge-функции в
проект szfgdruhlebfvcmlvxdk (`doctor` без ключа: все функции отвечают). Секреты площадок (TikTok,
Google, Threads, `PUBLISH_TOKEN_KEY`) и n8n-импорты — отдельными шагами ниже.

Состояние n8n (n8n.zapoinov.com, сверено 2026-09-04): из 35 воркфлоу к платформе относятся
«🚀 Система автопостинга» (pafUBGlU0DlbzGIc, активен, контракты `publish-intake` /
`publish-worker` совпадают с выкаченными функциями) и старый «Мониторинг конкурентов»
(qZ3WyT7_vF18f7MXF9Mqe, активен с марта, Apify-токен зашит в URL нод — ротировать и вынести
в Credentials). **Не импортированы**: `docs/n8n-content-pipeline-v5.json`,
`docs/n8n-content-pipeline-callback.json`, `docs/n8n-radar-crawler-v2.json` — без них темы
с движком `heygen` не рендерятся и радар не собирает источники (разбор уже собранного и
собственная лента работают на кронах Supabase).

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
| Источник не собирается | `radar_sources.last_error`; `radar_runs.status/error` (running дольше 20 мин → закроется ошибкой) | `APIFY_TOKEN` задан? (страница показывает баннер); «месячный лимит расхода исчерпан» — лимит/тариф Apify; «аккаунт закрыт или ник неверный» — проверить ник; лимиты и баланс Apify (`console.apify.com`) |
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

- Аудит приложения TikTok (до него — только приватные публикации) и расширение квоты YouTube
  Data API — внешние процедуры; код готов к обоим исходам.
- Движок `montage` как воркер очереди конвейера (темы с этим движком ждут).
- Рендер Reels faceless по-прежнему делает Reels-очередь (Claude-сессия по
  `docs/REELS-PIPELINE.md`); воркер конвейера ставит заявку и забирает результат.
- Графики по группам во вкладке «Группы»: сейчас таблица по `publish_group_metrics`.
- Нагрузочный тест на живых площадках (этап 5).
