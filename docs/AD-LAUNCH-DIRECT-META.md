# Запуск рекламы напрямую в Meta: без n8n, на кронах и Graph API

Документ отвечает на два вопроса:

1. **Как сейчас** устроен статичный контент в Контент-заводе и как из него запускается реклама.
2. **Как перевести запуск рекламы на прямые вызовы Meta Marketing API** (очередь + pg_cron +
   edge-функции), убрав n8n из этого контура. И — реально ли это.

Короткий ответ на второй вопрос: **реально, и это не переписывание с нуля.** ~70% логики запуска
уже лежит в `supabase/functions/launch-campaign/index.ts`. n8n в этом контуре выполняет роль
«исполнителя 4 HTTP-запросов». Не хватает трёх вещей: таргетинга, загрузки видео и очереди с
ретраями. Детали — в разделах 3–7.

---

## 1. Контур А: Контент-завод, статичный контент

### 1.1 Пользовательский путь

| Шаг | Файл | Что происходит |
|-----|------|----------------|
| Выбор типа | `src/pages/CreateStep1.tsx` | 9 типов: facebook-ads, google-ads, marketplace, insta-carousel, reels-cover, stories, youtube-thumb, web-banner, neuro-photo |
| Бриф | `src/pages/CreateStep2.tsx` | режим ввода: `text` / `photo` / `link`; товар, описание, ссылка, доп. инструкции |
| Стили и генерация | `src/pages/CreateStep3.tsx` (2354 стр.) | стили, формат/аспект, бренд-шаблон, логотип, copy-mode, кол-во вариантов → отправка |

Фото пользователя заливаются в Supabase Storage (bucket `content-factory-uploads`, проект
`szfgdruhlebfvcmlvxdk`) — в webhook уходят **только публичные URL**, не multipart.

### 1.2 Сборка payload

Три библиотеки собирают контракт (описан в `docs/n8n-content-factory-webhook-contract.md`):

- `src/lib/contentFactoryPayload.ts` — `image_urls`, marketing-блок, формат, `assertNeuroPhotoPayload()`
- `src/lib/contentFactoryWebhook.ts` — финальный JSON: **плоские поля на корне + полный дубль в `body`**
  (ноды n8n читают `$json.body ?? $json`)
- `src/lib/contentFactoryRoutes.ts` — `typeId → content_type` (ключ маршрутизации для `Switch1` в n8n)

Ключевые поля, которые n8n читает напрямую из `body`: `content_type`, `prompt` (это
`finalTechnicalBrief` — полное ТЗ со стилем, брендом, текстом на креативе), `name`, `description`,
`image_urls`, `color`, `language`, `aspect`, `slides`, `fb_niche`, `ctas`, `request_id`.

Две ловушки, зафиксированные в комментариях кода (`CreateStep3.tsx:1310-1340`) — их нужно помнить
при любой миграции:

- пустые опциональные поля (`link`, `audio_url`) **не включаются в JSON** — IF-ноды n8n проверяют
  через `exists`, и пустая строка проходит дальше, роняя HTTP-ноду с `Invalid URL`;
- отправка идёт **JSON, не multipart** — иначе `body.content_type` становится `undefined`
  и модель начинает галлюцинировать.

### 1.3 Транспорт и обратная связь

```
CreateStep3  →  edge content-factory-proxy  →  n8n webhook/clony-yurii
   (JSON)          (requireUser, 120s)          (workflow dCQ20aXv6B9LRjDe)
```

`content-factory-proxy` существует ровно для того, чтобы браузер не ходил на n8n напрямую (CORS +
обрывы в Lovable preview). Один POST на каждый выбранный стиль, у каждого свой детерминированный
`request_id = project + batch + style` (`contentFactoryRequestId.ts`).

Результат возвращается **не ответом на HTTP**, а через БД:

```
n8n (service_role)  →  INSERT content_factory_results (request_id, slide_index, status, image_url)
                                    ↓ Supabase Realtime
CreateStep3 (подписка по request_id) → подменяет плейсхолдер на картинку
                                    ↓
                       saveGalleryItem → content_factory_gallery
```

Таблицы — `supabase/migrations_client_config/006_content_factory_results.sql` и
`007_content_factory_gallery_brand.sql`.

### 1.4 Что делает сам workflow

Workflow `dCQ20aXv6B9LRjDe` («Clony AI MarkVision») лежит в проекте n8n, недоступном текущему
MCP-токену. Но в том же инстансе есть его рабочий клон — **«Даяна Сontent ЗАВОД»**
(`6pnv6NrDkbwyCflT`, webhook `/webhook/new`, 87 нод). Структура:

```
Webhook
  → IF: link / image / audio / text (разбор режима ввода)
      · link  → ScrapingBee (HTML + скриншот) → Gemini «analyze screenshot»
      · image → Gemini/Claude «Analyze image» → image_analyse
      · audio → Gemini «Analyze audio»
      · instagram → Apify actor → Get dataset items
  → Supabase: Create a record (лог заявки)
  → Switch1 по body.content_type
      · fb-target        → chainLlm «facebook ads»
      · insta-carousel   → chainLlm «slides instagram carousel»
      · instagram-stories→ chainLlm «stories»
      · neuro-photo      → chainLlm «ai photo»
      · … (9 веток)
  → Parse Strategy (code) → Loop Over Items
      → Download Images → To Base (base64)
      → HTTP «Generate image nano banana pro» (Gemini image gen, style-reference)
      → Wait → Convert to File → Cloudinary upload → Format URL
  → Supabase «AI DESIGN Save All» (content_factory_results / gallery)
  → Telegram «Send a photo message»
```

То есть здесь n8n — **не транспорт, а фабрика промптов и картинок**: 9 разных LLM-цепочек,
мультимодальный анализ входа, скрейпинг, генерация изображений, Cloudinary. Это содержательная
логика, и её вынос — отдельный большой проект (см. раздел 8: **это НЕ входит в задачу**).

---

## 2. Контур Б: запуск рекламы — как есть сейчас

### 2.1 UI

`src/pages/Ads.tsx` → три вкладки: **Кабинеты** (`CabinetRow`), **Креативы**
(`AdsCreativesPanel` — аналитика уже существующих в Meta объявлений), **Кампании**
(`CampaignsWorkspace`).

Запуск — `src/components/ads/CreateCampaignDialog.tsx` (1535 стр.):

- **цель**: `site-leads` | `meta-form` | `whatsapp`
- **режим**: `create` (создать объявление) или `existing` (продвинуть публикацию IG)
- **формат**: `single` | `carousel` | `existing_post`
- **файлы**: `feed`, `stories`, `carousel[]` — обычный `<input type="file">`
- **кроп**: картинки режутся **в браузере** (`src/lib/cropMedia.ts`, canvas) → `baked=true`;
  видео **не режется**, уходит `cropMeta` с расчётом `crop=W:H:X:Y` для ffmpeg на стороне n8n

### 2.2 Edge `launch-campaign`

`supabase/functions/launch-campaign/index.ts` (546 стр.) — здесь уже сделана основная работа:

1. `requireUser` + проверка роли `admin`/`manager`
2. резолв `access_token` и `ad_account_id` (с нормализацией `act_`), раскладка по ~15 алиасам
   (`ACCESS_TOKEN`, `accesstoken`, `fb_token`, …) — это следы того, что n8n читает поля вразнобой
3. **загрузка картинок прямо в Meta**: `POST /act_X/adimages` → `image_hash` (и одиночно, и каруселью)
4. сборка **готовых тел Graph API**:
   - `campaignBody` — `objective` по цели (`OUTCOME_SALES` / `OUTCOME_LEADS` / `OUTCOME_ENGAGEMENT`), `status: PAUSED`
   - `adSetBody` — `daily_budget`, `billing_event`, `optimization_goal`, `destination_type`, `promoted_object`
     (`pixel_id` + `custom_event_type` / `page_id` / `page_id` + `whatsapp_phone_number`)
   - `creativeBody` — `object_story_spec` с `link_data` (или `child_attachments` для карусели);
     для режима `existing` — `object_id` + `instagram_user_id` + `source_instagram_media_id`
   - `storiesCreativeBody`, `adBody`
5. генерация `launchId` (uuid)
6. `POST` всего этого (FormData + оригинальные файлы) в `https://n8n.zapoinov.com/webhook/ai-target-launch`
   с **ACK-таймаутом 8 секунд**; таймаут трактуется как успех («n8n продолжает в фоне»)

### 2.3 Что остаётся n8n

Судя по тому, что edge отдаёт готовые тела запросов, workflow `ai-target-launch` делает:

- 4 последовательных POST в Graph: `/campaigns` → `/adsets` → `/adcreatives` → `/ads`
- **достраивает `targeting`** (в `adSetBody` его нет вообще — Meta без него не примет ad set)
- загружает **видео** (`/advideos`) и режет его ffmpeg-ом по `cropMeta`
- зовёт `campaign-status-callback` (заголовок `X-Callback-Secret`) → пишет `status`, `status_step`,
  `meta_campaign_id/adset_id/ad_id` в `ad_campaigns` по `launch_id`
- зовёт `meta-creative-upsert` (`x-creative-key`) → строка в `meta_creatives`, чтобы цепочка
  «креатив → CTWA → лид → CRM-этап → CAPI» не рвалась

### 2.4 Что после запуска

`meta-structure-sync` (крон) и `meta-daily-sync` (крон, `30 0 * * *`) уже ходят в Graph API
**напрямую из edge-функций** — то есть прямая работа с Meta в этом проекте давно обкатана.

### 2.5 Три находки, важные для дизайна

**(1) Таргетинга нет в edge, но он есть во фронте.** `CreateCampaignDialog.tsx:900` шлёт
`clientConfig.targeting = { geo, age_min, age_max, gender, languages, interests, exclusions }` и
`clientConfig.schedule = { timezone, days_of_week, start_time, end_time, launch_hour, auto_launch_enabled }`.
`launch-campaign` их **не читает**. Значит, весь перевод «Алматы» → `geo_locations.cities[].key` и
«интерес» → `adinterest id` живёт в n8n. **Это главный кусок, который нужно портировать.**

**(2) БД уже готова к кронам.** В `ad_cabinets` есть `auto_launch_enabled`, `launch_hour`,
`days_of_week`, `timezone`, `target_*`, `creative_media_urls` и даже частичный индекс
`ON ad_cabinets (auto_launch_enabled, online) WHERE auto_launch_enabled = true`. Схема под
крон-запуск спроектирована, но воркера, который бы её читал, в репозитории нет.

**(3) Контент-завод и реклама не связаны.** В `src/components/ads/` нет ни одного упоминания
`content_factory_gallery`. Сгенерённый баннер скачивают вручную и вручную же загружают в мастер
запуска. Это разрыв, который прямой контур закрывает бесплатно (раздел 6).

---

## 3. Целевая архитектура: очередь + воркер + крон

Принцип: **никаких длинных синхронных цепочек**. Запуск — это задание в таблице, которое
конечный автомат двигает по шагам. Ровно та же схема, что уже работает в репозитории для
`capi_outbox` (`capi-outbox-worker`) и `montage_jobs` (`montage-worker`).

```
                    ┌─ ручной запуск (мастер) ──┐
                    │                            ▼
CreateCampaignDialog ──POST──► edge ad-launch-enqueue ──► INSERT ad_launch_jobs (queued)
                                        │                          │
                                        └── fire-and-forget ──────┐│
                                            (EdgeRuntime.waitUntil)││
                    ┌─ авто-запуск по расписанию ─┐               ▼▼
   pg_cron */5 ──► edge ad-launch-scheduler ───────────► INSERT ad_launch_jobs (queued)
                    (ad_cabinets.auto_launch_enabled,
                     launch_hour, days_of_week, timezone)
                                                                  │
   pg_cron */1 ──────────────────────────────────────────► edge ad-launch-worker
                    (страховка + ретраи + ожидание видео)          │
                                                                   ▼
                                              Meta Graph API (шаги 1..6)
                                                                   │
                                          UPDATE ad_launch_jobs + ad_campaigns
                                                                   │
                                                          Supabase Realtime → UI
```

Почему и очередь, **и** крон, а не «просто крон»:

- **pg_cron минимум — 1 минута.** Ждать до 60 секунд после нажатия «Запустить» неприемлемо.
  Поэтому `ad-launch-enqueue` кладёт задание и **сразу** дёргает воркер fire-and-forget
  (`EdgeRuntime.waitUntil` — паттерн уже есть в `binotel-webhook/index.ts:81`). Задержка ~0.
- **Крон — это не «двигатель», а страховка**: подобрать задания, которые упали, застряли
  (`processing` дольше N минут) или ждут готовности видео у Meta.

---

## 4. Схема данных

```sql
-- Очередь запусков. Одно задание = одна кампания.
CREATE TABLE public.ad_launch_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id     uuid NOT NULL UNIQUE,            -- тот же, что в ad_campaigns.launch_id
  project_id    uuid REFERENCES public.projects(id)   ON DELETE SET NULL,
  cabinet_id    uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  created_by    uuid,
  source        text NOT NULL DEFAULT 'manual',   -- manual | schedule | content_factory
  -- Вход: нормализованный payload мастера (цель, бюджет, тексты, targeting, ссылки на медиа).
  spec          jsonb NOT NULL,
  -- Прогресс конечного автомата.
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','processing','waiting_media','done','error','cancelled')),
  step          text,                             -- см. раздел 5
  meta_image_hashes  text[] NOT NULL DEFAULT '{}',
  meta_video_id      text,
  meta_campaign_id   text,
  meta_adset_id      text,
  meta_creative_id   text,
  meta_ad_id         text,
  attempts      integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,                      -- лизинг: защита от двойной обработки
  last_error    text,
  error_code    integer,                          -- код ошибки Meta
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX ON public.ad_launch_jobs (status, next_attempt_at)
  WHERE status IN ('queued','waiting_media');
CREATE INDEX ON public.ad_launch_jobs (project_id, created_at DESC);

-- Кэш справочников Meta: города/страны/интересы. Без него на каждый запуск
-- уходит 2-5 лишних вызовов /search и легко ловится throttle.
CREATE TABLE public.meta_targeting_cache (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,          -- adgeolocation | adinterest | adlocale
  query      text NOT NULL,
  country    text,
  result     jsonb NOT NULL,         -- нормализованный ответ Graph /search
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, query, country)
);

-- Расписания авто-запуска (если нужна гибкость сверх ad_cabinets.launch_hour).
CREATE TABLE public.ad_launch_schedules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  cabinet_id   uuid REFERENCES public.ad_cabinets(id) ON DELETE CASCADE,
  name         text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  cron_expr    text,                 -- '0 9 * * 1-5' в таймзоне кабинета
  spec         jsonb NOT NULL,       -- шаблон запуска (та же форма, что ad_launch_jobs.spec)
  -- Откуда берём креатив, если он не зашит в spec.
  creative_source text NOT NULL DEFAULT 'spec',  -- spec | content_factory_gallery
  last_run_at  timestamptz,
  next_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

`ad_campaigns` менять не нужно — там уже есть `launch_id`, `status`, `status_step`,
`status_message`, `meta_campaign_id/adset_id/ad_id`, `last_error`, `completed_at`.
Воркер пишет в неё напрямую (сервисным ключом), а `campaign-status-callback` остаётся
как есть — на переходный период, пока n8n ещё жив.

Для стриминга статуса в UI: `ALTER PUBLICATION supabase_realtime ADD TABLE public.ad_campaigns;`
и подписка в `CampaignsWorkspace` по `launch_id` — ровно как Контент-завод слушает
`content_factory_results` по `request_id`. Опрос статуса не нужен.

---

## 5. Конечный автомат воркера

`supabase/functions/ad-launch-worker/index.ts`. Авторизация: `x-automation-key` == 
`automation_settings.cron_secret` (как `capi-outbox-worker` и `binotel-import-calls`),
`verify_jwt = false` в `config.toml`.

Каждый шаг **идемпотентен**: если соответствующий `meta_*_id` уже записан — шаг пропускается.
Это и есть механизм ретрая: повторный запуск задания не создаёт вторую кампанию.

| # | `step` | Graph API | Условие пропуска |
|---|--------|-----------|------------------|
| 1 | `resolving_targeting` | `GET /search?type=adgeolocation&q=…`, `type=adinterest` (через `meta_targeting_cache`) | `spec.targeting_resolved` уже есть |
| 2 | `uploading_media` | `POST /act_X/adimages` (bytes) / `POST /act_X/advideos` (`file_url` — Meta сама скачает по публичной ссылке) | `meta_image_hashes` / `meta_video_id` непусты |
| 3 | `waiting_media` | `GET /<video_id>?fields=status` до `video_status = ready` | только для видео |
| 4 | `creating_campaign` | `POST /act_X/campaigns` | `meta_campaign_id` есть |
| 5 | `creating_adset` | `POST /act_X/adsets` | `meta_adset_id` есть |
| 6 | `creating_creative` | `POST /act_X/adcreatives` | `meta_creative_id` есть |
| 7 | `creating_ad` | `POST /act_X/ads` | `meta_ad_id` есть |
| 8 | `saving` | локальный upsert в `meta_creatives` + `ad_campaigns` | — |
| 9 | `activating` | `POST /<campaign_id>` `{status: ACTIVE}` | только если `spec.auto_activate = true` |

Шаг 9 намеренно отделён: сейчас всё создаётся в `PAUSED`, и это правильно по умолчанию —
включение остаётся осознанным действием (кнопкой или отдельным правилом).

**Взятие задания в работу** (лизинг вместо блокировок, как в `capi-outbox-worker`):

```sql
UPDATE public.ad_launch_jobs SET status = 'processing', locked_at = now(), attempts = attempts + 1
WHERE id IN (
  SELECT id FROM public.ad_launch_jobs
  WHERE status IN ('queued','waiting_media')
    AND next_attempt_at <= now()
    AND attempts < 6
  ORDER BY created_at
  LIMIT 5
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

Плюс отдельный «реаниматор» в том же кроне: `status='processing' AND locked_at < now() - interval '10 minutes'`
→ обратно в `queued`.

### Классификация ошибок Meta

Единая функция вместо «упало — ретраим»:

| Код Meta | Смысл | Реакция |
|----------|-------|---------|
| 4, 17, 80004, 613 | throttle / лимит вызовов | `next_attempt_at = now() + 2^attempts мин`, до 6 попыток; читать заголовок `X-Business-Use-Case-Usage` |
| 190 | токен протух / отозван | **фатально**, `status='error'`, уведомление в Telegram проекта |
| 200, 272, 294 | нет прав на ad account / страницу | фатально + понятный текст в `status_message` |
| 100 | битые параметры (`error_subcode` уточняет) | фатально — ретрай не поможет |
| 1, 2 | временная ошибка Meta | ретрай с backoff |
| 368 | аккаунт ограничен | фатально + алерт |

Всё, что не распознано → ретрай с backoff, после 6 попыток → `error`.

---

## 6. Мост «Контент-завод → реклама»

Разрыв из п. 2.5(3) закрывается на новой архитектуре почти даром, потому что задание принимает
**URL, а не файл**:

- В галерее Контент-завода (`ContentFactoryGallery.tsx`) — кнопка **«Запустить рекламу»**.
- Она создаёт `ad_launch_jobs` с `source = 'content_factory'` и `spec.creative = { image_url: <публичный URL> }`.
- Воркер на шаге 2 скачивает байты по URL и отдаёт в `/act_X/adimages` (для видео — сразу
  `file_url`, Meta скачает сама).
- Тексты (`primary_text`, `headline`, `description`, CTA) уже лежат в
  `content_factory_gallery.metadata` / `prompt_snapshot` — их можно подставить в мастер
  по умолчанию.

Кроп в браузере (`cropImageFile`) при этом остаётся для ручной загрузки, но для галереи не нужен:
Контент-завод уже генерит под нужный аспект (`contentFactoryAspect.ts`).

---

## 7. Кроны

```sql
-- 1. Двигатель очереди + страховка. Раз в минуту.
SELECT cron.schedule('ad-launch-worker-1min', '* * * * *', $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ad-launch-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('source', 'cron', 'batch_size', 5)
  );
$CRON$);

-- 2. Материализация авто-запусков по расписанию кабинета. Раз в 5 минут.
SELECT cron.schedule('ad-launch-scheduler-5min', '*/5 * * * *', $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ad-launch-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{"source":"cron"}'::jsonb
  );
$CRON$);

-- 3. Здоровье токенов: /debug_token по всем активным кабинетам. Раз в сутки.
SELECT cron.schedule('meta-token-health-daily', '0 6 * * *', $CRON$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/meta-token-health',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := '{}'::jsonb
  );
$CRON$);
```

Шаблон взят из уже работающих `20260829150000_binotel_import_cron.sql` и
`20260521200000_meta_sync_cron_auth_fix.sql` — тот же заголовок `x-automation-key`, тот же
`net.http_post`.

`ad-launch-scheduler` считает по кабинету: `auto_launch_enabled = true AND online`, текущий час
в `timezone` кабинета совпадает с `launch_hour`, день недели входит в `days_of_week`, и за
сегодня по этому кабинету ещё нет задания (защита от дублей — уникальный ключ
`(cabinet_id, date_trunc('day', created_at))` через частичный индекс).

### Токен

`supabase/functions/_lib/metaToken.ts` уже резолвит каскадом:
`bodyToken → ad_cabinets.access_token (OAuth) → meta_tokens.access_token (проект) →
automation_settings.meta_access_token → env META_ACCESS_TOKEN`. Ничего изобретать не нужно.

Рекомендация по типу токена: **System User token из Business Manager** — он не истекает, в
отличие от пользовательского long-lived (60 дней). Права: `ads_management`, `ads_read`,
`business_management`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`.
`meta-token-health` раз в сутки дергает `GET /debug_token` и шлёт алерт в Telegram проекта за
7 дней до `expires_at` — иначе запуски начнут падать с кодом 190 молча.

---

## 8. Что остаётся у n8n

**Контур запуска рекламы — уходит полностью.** Workflow `ai-target-launch` после миграции
отключается; `launch-campaign` переименовывается в `ad-launch-enqueue` (или сохраняет имя,
но вместо `fetch(N8N_WEBHOOK)` делает `INSERT` в очередь).

**Контур Контент-завода — остаётся.** Там n8n делает содержательную работу: 9 LLM-цепочек,
мультимодальный анализ, ScrapingBee, Apify, генерация изображений, Cloudinary (раздел 1.4).
Его вынос технически возможен (в репозитории уже есть `_lib/aiProvider.ts` и опыт с
`marketing-os-creatives`), но это отдельный проект на другой порядок трудозатрат, и он **не
требуется** для того, чтобы запускать рекламу напрямую. Два контура связаны только через
публичный URL картинки — а он одинаково доступен из обоих миров.

---

## 9. План внедрения

| Фаза | Содержание | Оценка |
|------|-----------|--------|
| **0. Разведка** | Выгрузить JSON workflow `ai-target-launch`, зафиксировать точный порядок вызовов и — главное — как он строит `targeting` (какие поля `geo_locations`, как резолвит города и интересы). Без этого фаза 2 будет угадыванием. | 0.5 дня |
| **1. Каркас** | Миграция (`ad_launch_jobs`, `meta_targeting_cache`, realtime на `ad_campaigns`), `ad-launch-worker` со скелетом автомата, кроны, `x-automation-key`. Пока умеет только шаги 4–8 на готовом `image_hash`. | 1–1.5 дня |
| **2. Таргетинг** | Портирование `targeting` из `clientConfig.targeting` → Meta spec, `/search` + кэш, дефолты по `ad_cabinets.city`. **Самая содержательная часть.** | 1–2 дня |
| **3. Фото-путь end-to-end** | `ad-launch-enqueue` вместо вызова n8n, `single` + `carousel` + `existing_post`, realtime-статус в `CampaignsWorkspace`. Тумблер `USE_DIRECT_LAUNCH` — переключение между n8n и прямым контуром без деплоя. | 1 день |
| **4. Видео** | `/advideos` через `file_url`, ожидание `video_status = ready` в состоянии `waiting_media`. Кроп — см. риск R1. | 1 день |
| **5. Кроны и мост** | `ad-launch-scheduler` на `auto_launch_enabled`, кнопка «Запустить рекламу» в галерее Контент-завода, `meta-token-health`. | 1–1.5 дня |
| **6. Отключение n8n** | Прогон обоих контуров параллельно на одном кабинете, сверка результата в Ads Manager, снятие тумблера, отключение workflow. | 0.5 дня |

Итого **6–8 рабочих дней** до полного отключения n8n из контура запуска.

---

## 10. Риски

| # | Риск | Митигация |
|---|------|-----------|
| **R1** | **Кроп видео.** Edge Functions — это Deno, ffmpeg там нет. Сейчас режет n8n. | Три варианта, по возрастанию цены: (а) грузить видео как есть и использовать `asset_feed_spec` для плейсментов — Meta сама подгонит кадрирование; (б) кроп в браузере через WebCodecs/MediaRecorder перед загрузкой (как уже делается для картинок); (в) переиспользовать ffmpeg из montage-контура этого же репозитория как отдельный воркер. **Рекомендация: (а) на фазу 4, (б) — если качество не устроит.** Ни один вариант не требует n8n. |
| **R2** | Дубли кампаний при ретрае. | Идемпотентность по шагам (`meta_*_id` в задании) + `UNIQUE (launch_id)` + `FOR UPDATE SKIP LOCKED`. Дополнительная страховка: перед созданием кампании `GET /act_X/campaigns?filtering=[{field:"name",operator:"EQUAL",value:"<name>"}]`. |
| **R3** | Rate limits Meta при пакетном авто-запуске. | Кэш `meta_targeting_cache` (убирает 2–5 вызовов `/search` на запуск), `batch_size = 5`, экспоненциальный backoff, чтение `X-Business-Use-Case-Usage`. |
| **R4** | Токен протухает молча — запуски падают, никто не замечает. | `meta-token-health` + алерт в Telegram; переход на System User token. |
| **R5** | Лимит времени edge-функции (~150 с). | Из-за автомата ни одно задание не выполняет больше одного-двух шагов за вызов; ожидание видео вынесено в состояние `waiting_media` и подбирается следующим кроном. |
| **R6** | Потеря логики, зашитой в n8n и нигде не задокументированной (та же сборка `targeting`, обработка ошибок, порядок полей). | Фаза 0 — выгрузка JSON workflow до начала работ. Параллельный прогон в фазе 6 со сверкой в Ads Manager. |
| **R7** | Регресс цепочки атрибуции. | `meta-creative-upsert` вызывается воркером на шаге 8 **до** ответа пользователю — сейчас это делает n8n постфактум, то есть станет надёжнее, а не хуже. |

---

## 11. Вывод

**Это реально, и запас прочности выше, чем кажется.**

Три факта, которые делают миграцию скорее переносом, чем разработкой:

1. **Логика запуска уже написана** — `launch-campaign` строит полные тела Graph API для кампании,
   ad set, креатива и объявления, и **уже сам загружает картинки в Meta** через `/act_X/adimages`.
   n8n получает готовые тела и просто их отправляет.
2. **Прямая работа с Meta из edge-функций обкатана** — `meta-structure-sync`, `meta-daily-sync`,
   `capi-outbox-worker` годами ходят в Graph API напрямую, по крону, с авторизацией
   `x-automation-key`. Новый воркер — четвёртый в том же ряду.
3. **Инфраструктура под кроны уже есть** — pg_cron + pg_net + `automation_settings.cron_secret`,
   а в `ad_cabinets` уже лежат `auto_launch_enabled`, `launch_hour`, `days_of_week`, `timezone` и
   индекс под них. Схему авто-запуска спроектировали раньше, чем воркера.

Настоящей новой работы ровно две: **сборка `targeting`** (то, что сейчас невидимо делает n8n) и
**загрузка видео** (`/advideos` + ожидание готовности). Всё остальное — очередь, ретраи и
перенос вызова.

Побочные выигрыши, которых нет у n8n-варианта: исчезает «слепой» ACK-таймаут в 8 секунд
(сейчас таймаут трактуется как успех — пользователь видит «принято», даже если запуск не
состоялся), появляется честный статус по шагам через Realtime, ретраи вместо тихой потери
задания, и мост «Контент-завод → реклама» без ручного скачивания баннера.

Единственная честная оговорка: **до фазы 0 (выгрузка JSON `ai-target-launch`) оценка в 6–8 дней
остаётся оценкой.** Весь риск проекта сосредоточен в том, чего мы пока не видим — в том, как
именно этот workflow собирает таргетинг.
