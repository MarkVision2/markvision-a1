# Запуск рекламы: как работает сейчас и как унести с n8n на кроны + Meta API

Документ-разбор раздела **Управление рекламой** (`/ads`) и n8n-флоу
`AI-targetolog1` (`https://n8n.zapoinov.com/workflow/LncxAleDlMPOb3hP`, 130 нод, активен),
плюс проект переноса логики запуска на нативные Supabase Edge Functions + `pg_cron`.

---

## Часть 1. Как реклама запускается сегодня

### 1.1. Цепочка целиком

```
CreateCampaignDialog (браузер)
  │  multipart/form-data: payload(JSON) + creative_feed / creative_stories / creative_carousel_N
  ▼
supabase/functions/launch-campaign            ← наш код, Deno
  │  1) auth: admin | manager
  │  2) upload картинок → POST /{act}/adimages → image_hash
  │  3) сборка алиасов + campaignBody / adSetBody / creativeBody / adBody
  │  4) POST на n8n webhook, ждём ACK ≤ 8 c
  ▼
n8n «Webhook Запуск» (path: ai-target-launch)  ← вся реальная логика
  │  Vertex Gemini (анализ креатива) → Parse Webhook → Respond OK (ACK)
  │  ├─ IG-boost  → Build IG Post Plan ──┐
  │  └─ обычный   → AI Agent Таргетолог ─┤
  │                                      ▼
  │                                 Parse JSON1  (44 КБ JS — «мозг»)
  │  Upload Photo/Video to FB → creatives → Create Campaign → Create AdSet → Create Ad
  │  → Save Ad Creative (campaign_learnings + meta-creative-upsert) → Telegram
  ▼
Extract AdSet ID1 → POST campaign-status-callback → UPDATE public.ad_campaigns
```

### 1.2. Фронт — `src/components/ads/CreateCampaignDialog.tsx` (1535 строк)

Мастер собирает запуск:

| Шаг | Что выбирается | Источник данных |
|---|---|---|
| Клиент | кабинет из `ad_cabinets` | `useCabinetsStore` |
| Цель | `whatsapp` / `site-leads` / `meta-form` | — |
| Страница FB | список страниц кабинета | edge `meta-page-assets` |
| Режим | «создать объявление» / «продвинуть публикацию IG» | `meta-page-assets?kind=ig_media` |
| Формат | single / carousel | — |
| Креатив | feed 4:5 + stories 9:16, кроп («bake») на клиенте | Canvas в браузере |
| Текст, бюджет ($) | — | — |

Валидация: `whatsapp` → нужен номер; `site-leads` → пиксель + событие; `meta-form` → `lead_form_id`.

Дальше фронт:
1. генерирует `launchId` (uuid) — сквозной идентификатор запуска;
2. шлёт `FormData` на `{VITE_CLIENT_SUPABASE_URL}/functions/v1/launch-campaign` с жёстким таймаутом **12 c**;
3. **таймаут трактуется как «принято»** (`accepted = true`);
4. пишет строку в `ad_campaigns` со `status='queued'` и `launch_id`;
5. рисует сводку «Кампания отправлена».

Прогресс потом читается реалтаймом: `useAdCampaignLaunches` → `ad_campaigns`
(`status`, `status_step`, `status_message`, `last_error`, `meta_campaign_id`),
отображается в `CampaignsWorkspace` («Активные запуски»).

### 1.3. Edge `launch-campaign` (546 строк)

Что реально делает:

* `requireUser` + роль `admin` или `manager`;
* требует env `META_ACCESS_TOKEN` (даже если у кабинета свой OAuth-токен);
* грузит **изображения** в `POST /v19.0/{act}/adimages` → `image_hash`
  (карусель — по порядку `creative_carousel_0..N`);
* нормализует `act_…`, раскладывает токен/аккаунт/пиксель в 4 регистрах имён
  (`fb_token`/`fbtoken`/`access_token`/`accesstoken`, `AD_ACCOUNT`/`adAccount`/…) —
  чистый костыль под разнородные ноды n8n;
* собирает `campaignBody` / `adSetBody` / `creativeBody` / `storiesCreativeBody` / `adBody`;
* перекладывает всё + исходные файлы в новый `FormData` и шлёт в n8n;
* ACK ≤ 8 c; таймаут → отвечает фронту `202 queued`.

> **Важно:** тела, собранные в `launch-campaign`, n8n в обычном сценарии
> **игнорирует** — `Parse JSON1` собирает свои с нуля. Единственное, что
> реально доезжает, — это `image_hash`, файлы и поля payload. Для IG-boost
> ветки есть fast-path, но и он строится в `Build IG Post Plan`, а не у нас.
> Логика существует в двух местах и они **разошлись**: edge ставит
> `status: "PAUSED"`, n8n — `status: "ACTIVE"`. Работает n8n-версия.

### 1.4. n8n `Parse JSON1` — фактический «мозг» запуска

44 КБ JS, который и определяет, что появится в кабинете Meta:

**Текст объявления.** Приоритет: подпись пользователя (≥ 25 символов, без URL и командных слов)
→ AI-текст → `client_configs.ad_fallback_body`. Сверху всегда клеится
`ad_footer_template` (адрес/телефоны).

**Гео.** `client_configs.city` режется по запятым, каждый токен резолвится через
Meta `/search` → `cities` (radius 25 km) / `regions` / `countries`;
fallback — `{countries:["KZ"]}`. Всегда включается `targeting_automation.advantage_audience = 1`
(из-за чего `age_min/age_max` не выставляются — Meta их отвергает).

**Назначение.** `whatsapp` / `website` / `leadform` / `instagram` / `engagement`.
Есть guard: нет своего WA-номера, но есть лид-форма → принудительно `leadform`
(иначе Meta вернёт `#1487246`).

**Код-слово.** Из транскрипта видео (Gemini) выцепляется «напишите +/СТАРТ/слово X»
→ `wa.me/{номер}?text={код}`.

**Лид-форма.** Если не задана — берётся page access token через `/me/accounts`
и первая `ACTIVE` форма страницы.

**Имена.**
`campaign = "{Бренд} | {Формат} | {Цель} | {ддММ} | AI"`,
`adset/ad = "{Бренд} | {Услуга} | {Формат} | {ддММ} | AI | g{N}"`.

**Консолидация кампаний.** Ищет сегодняшнюю кампанию с тем же `objective`
и теми же тегами имени. Нашёл → `Create Campaign` превращается в `GET`
(кампания переиспользуется), группа создаётся всегда новая (бюджет на группе, ABO).
Против гонки при параллельных запусках — `Math.random()*8000` мс джиттер
и до 4 повторов по 4 c.

**Старт.** До 12:00 Алматы → +2 минуты; после → 00:00 следующих суток.

**Тела Meta API:**

```js
adSetBody = {
  daily_budget, bid_strategy: "LOWEST_COST_WITHOUT_CAP", billing_event: "IMPRESSIONS",
  optimization_goal: website ? "OFFSITE_CONVERSIONS" : leadform ? "LEAD_GENERATION"
                   : (waba_phone_number_id ? "CONVERSATIONS" : "LINK_CLICKS"),
  destination_type:  website ? "WEBSITE" : leadform ? "ON_AD"
                   : (waba_phone_number_id ? "WHATSAPP" : "WEBSITE"),
  promoted_object:   website ? {pixel_id, custom_event_type} : {page_id, whatsapp_phone_number?},
  attribution_spec:  website ? [CLICK_THROUGH 7d, VIEW_THROUGH 1d] : undefined,
  start_time, targeting, status: "ACTIVE"
}
campaignBody = { objective: leadform ? OUTCOME_LEADS : website ? (PURCHASE ? OUTCOME_SALES : OUTCOME_LEADS)
                            : (waba ? OUTCOME_ENGAGEMENT : OUTCOME_TRAFFIC), status: "ACTIVE" }
creativeBody = { object_story_spec: {page_id, instagram_user_id?, link_data|video_data},
                 url_tags: "utm_source=meta&utm_campaign={{campaign.name}}&utm_content={{ad.id}}_{{ad.name}}" }
adBody      = { tracking_specs: [{ "action.type":["offsite_conversion"], fb_pixel:[pixel_id] }] }
```

Затем цепочка HTTP-нод: `/adcreatives` → `/campaigns` → `/adsets` → `/ads`,
после — запись в `campaign_learnings` и вызов прод-функции `meta-creative-upsert`
(чтобы CTWA-лиды матчились с креативом, не дожидаясь ночного `meta-structure-sync`).

### 1.5. Вторая половина n8n — ежедневная оптимизация

`Schedule Trigger` (10:00) и ручной `POST /webhook/manual-optimize`:

```
Detect Mode (утро/ночь по часу Алматы)
 → Set Accounts (все client_configs с токеном + page tokens)
 → Split In Batches (по кабинету)
 → Yesterday report (/insights level=ad)
 → Get budget (/adsets)
 → Fetch Lead Quality (insights + креативы + таргетинг + leads_crm + pipeline_stages → score)
 → Analyze Conversations → Translate
 → Auto-Pause  ←── главный алгоритм
 → Format Report → Telegram
```

`Auto-Pause` (порог-машина, всё захардкожено):

| Параметр | Значение |
|---|---|
| `ROLLING_MAX_CPL` | $4 (3 дня) |
| `ROLLING_MAX_SPEND_NO_LEAD` | $15 |
| `TODAY_EMERGENCY_SPEND` | $10 при 0 лидов → стоп |
| `MIN_QUALITY_SCORE` / `QUALITY_SHIELD` | 45 / 70 |
| `GRACE_PERIOD_DAYS` | 5 |
| `SCALE_MIN_SCORE` / `SCALE_MAX_CPL` | 75 / $2.5 → бюджет ×1.2, кап $50 |
| CRM-оплаты | кап скейла $100, кампанию не паузим |
| Выгорание | частота ≥ 3.0 или ≥ 2.0 + падение CTR на 30 % |
| Качество лидов | `ai_score ≥ 70`; < 20 % качественных при ≥ 5 лидах → стоп |

Плюс побочный эффект: при наличии оплат в CRM шлёт `Purchase` в CAPI
(`capi_outbox` + прямой `POST /{pixel_id}/events`).

---

## Часть 2. Что сломано или опасно (нашлось при разборе)

1. **Бюджет жёстко срезан до $5/сутки.**
   `Parse JSON1`: `DAILY_BUDGET = Math.min(бюджет_из_мастера, 500)` — 500 центов.
   Менеджер ставит $50, в Meta уезжает $5. Это не настройка, это забытый предохранитель.

2. **`service_role` JWT проекта `szfgdruhlebfvcmlvxdk` захардкожен в теле n8n-нод**
   (`Parse Webhook`, `Set Accounts`, `Fetch Lead Quality`, `Auto-Pause`, `Save Ad Creative`, …).
   Это ключ с полным обходом RLS, лежащий в JSON воркфлоу. Там же —
   `callbackSecret` от `campaign-status-callback` и ключ imgbb.
   **При миграции ключи обязаны быть ротированы**, независимо от всего остального.

3. **Статус запуска обновляется только при полном успехе.**
   Колбэк шлёт единственная нода `Extract AdSet ID1` — в самом конце. Любая ошибка
   раньше (нет page token, Meta вернула #1487246, видео не дообработалось) →
   строка в `ad_campaigns` навсегда висит `queued`, `last_error` пуст.

4. **Таймаут = «успех» на двух уровнях.** Edge считает `TimeoutError` за `202 queued`,
   фронт считает свой abort за `accepted`. Пользователь видит «Кампания отправлена»
   даже когда n8n не принял запрос.

5. **RLS против роли.** `launch-campaign` пускает `manager`, а на `ad_campaigns`
   политика записи `ad_campaigns_write_admin` (FOR ALL, только admin).
   У менеджера `saveCampaign()` падает, ошибка глотается `catch {}` → строки нет →
   колбэку нечего обновлять → запуск не виден в UI вообще.

6. **Двойная разошедшаяся логика сборки тел** (edge vs `Parse JSON1`), см. 1.3.

7. **Гонка решается джиттером.** `Math.random()*8000` + 4 ретрая — при трёх
   одновременных запусках дубли кампаний всё ещё возможны.

---

## Часть 3. Перенос на кроны + Meta API напрямую. Это реально

### 3.1. Почему реально

* В n8n **нет ни одной операции, кроме HTTP**: `graph.facebook.com` + PostgREST того же
  Supabase-проекта. Всё это Deno делает нативно.
* Инфраструктура уже боевая: `pg_cron` + `pg_net` используются 8+ раз
  (`capi-outbox-worker` ежеминутно, `meta-daily-sync`, `meta-structure-sync`,
  `broadcast-worker`, `greenapi-crm-ingest`, `binotel-import-calls`, …).
* Паттерн «очередь + воркер» в репозитории уже отработан: `montage_jobs`,
  `reels_jobs`, `capi_outbox`, `broadcast`.
* Токены Meta уже резолвятся: `_lib/metaToken.ts`
  (`bodyToken → ad_cabinets.access_token → meta_tokens → automation_settings → env`).
* Telegram уже есть (`TELEGRAM_BOT_TOKEN`, `report-send`).
* LLM уже есть (`_lib/aiProvider.ts`, `montage-ai`) — LangChain-агент не нужен.
* Приложение и n8n живут в **одном** проекте `szfgdruhlebfvcmlvxdk` — переносить данные некуда,
  `client_configs` / `campaign_learnings` / `leads_crm` уже на месте.

### 3.2. Целевая архитектура

```
CreateCampaignDialog
   │ POST multipart (или presigned upload в Storage + JSON)
   ▼
edge launch-campaign  (переписан)
   │ auth → валидация → медиа в Meta → INSERT ad_launch_jobs(status='queued')
   │ fire-and-forget пинок воркера → ответ фронту < 2 c с launchId
   ▼
edge ads-launch-worker      ← state machine, идемпотентная
   │  cron '* * * * *' (страховка) + мгновенный пинок
   │  шаг за шагом, каждый шаг → UPDATE ad_campaigns.status_step (UI уже realtime)
   ▼
Meta Graph API v22.0
   /adimages · /advideos · /adcreatives · /campaigns · /adsets · /ads
   ▼
campaign_learnings + meta_creatives + Telegram
```

Отдельно — оптимизатор:

```
cron '0 5 * * *'  (10:00 Алматы, утренний отчёт)   ─┐
cron '0 17 * * *' (22:00 Алматы, ночная оптимизация)─┴→ edge ads-optimizer → Telegram
```

### 3.3. Схема БД

```sql
create table public.ad_launch_jobs (
  id             uuid primary key default gen_random_uuid(),
  launch_id      uuid not null unique,          -- сквозной id с фронта
  project_id     uuid not null,
  cabinet_id     uuid not null references public.ad_cabinets(id) on delete cascade,
  status         text not null default 'queued',-- queued|running|awaiting_video|success|error
  step           text,                          -- creative|campaign|adset|ad|sync
  attempts       int  not null default 0,
  next_attempt_at timestamptz not null default now(),
  request        jsonb not null,                -- цель, бюджет, тексты, media refs
  -- результаты шагов: заполняются ПЕРЕД переходом дальше → ретрай не создаёт дублей
  meta_video_id     text,
  meta_image_hash   text,
  meta_creative_id  text,
  meta_campaign_id  text,
  meta_adset_id     text,
  meta_ad_id        text,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.ad_launch_jobs (status, next_attempt_at);

-- ключ консолидации: одна кампания на (кабинет, дата, цель, objective)
create table public.ad_campaign_groups (
  ad_account_id    text not null,
  date_key         date not null,
  goal             text not null,
  objective        text not null,
  meta_campaign_id text not null,
  created_at       timestamptz not null default now(),
  primary key (ad_account_id, date_key, goal, objective)
);

-- пороги оптимизатора: из хардкода в настройки проекта
create table public.ads_optimizer_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default true,
  max_cpl numeric not null default 4,
  max_spend_no_lead numeric not null default 15,
  emergency_spend numeric not null default 10,
  min_quality_score int not null default 45,
  quality_shield int not null default 70,
  grace_period_days int not null default 5,
  scale_min_score int not null default 75,
  scale_max_cpl numeric not null default 2.5,
  scale_step numeric not null default 1.2,
  scale_cap_usd numeric not null default 50,
  qualified_ai_score_min int not null default 70,
  telegram_chat_id text
);
```

RLS: `ad_launch_jobs` — SELECT по `user_can_access_project(project_id)`,
запись только `service_role`. Заодно чинится проблема №5: строку создаёт
edge сервисным ключом, а не браузер под RLS.

### 3.4. Воркер как машина состояний

Один вызов = один шаг. Это ключевое решение: снимает лимит времени жизни
edge-функции и делает ретраи безопасными.

| Шаг | Действие | Идемпотентность |
|---|---|---|
| `resolve` | кабинет + `resolveMetaAccessToken({cabinetId, projectId})` | — |
| `copy` | опционально AI-текст через `_lib/aiProvider.ts`; **если текст введён в мастере — шаг пропускается целиком** | результат в `request` |
| `media` | картинки → `/adimages`; видео → `/advideos` (лучше `file_url` из Storage) | `meta_image_hash` / `meta_video_id` |
| `awaiting_video` | `GET /{video_id}?fields=status` пока не `ready` | опрос по крону, без блокировки |
| `creative` | `POST /{act}/adcreatives` | `meta_creative_id` |
| `campaign` | lock по `(ad_account, date, goal, objective)`, `INSERT … ON CONFLICT DO NOTHING` в `ad_campaign_groups`; выиграл — `POST /campaigns`, проиграл — берёт чужой id | `meta_campaign_id` |
| `adset` | `POST /{act}/adsets` | `meta_adset_id` |
| `ad` | `POST /{act}/ads` | `meta_ad_id` |
| `sync` | `campaign_learnings` + `meta-creative-upsert` + Telegram | upsert |

Каждый шаг пишет `ad_campaigns.status_step` / `status_message` — **UI уже это читает
реалтаймом, менять фронт не нужно**. Ошибка → `status='error'`, `last_error`,
экспоненциальный `next_attempt_at` (1/4/16 мин, 3 попытки) → и пользователь
наконец видит причину вместо вечного `queued`.

Гонку кампаний решает `ad_campaign_groups` PK + `ON CONFLICT DO NOTHING` —
это гарантия БД, а не 8-секундный джиттер.

Выборка задания:

```sql
select * from public.ad_launch_jobs
 where status in ('queued','running','awaiting_video')
   and next_attempt_at <= now()
 order by created_at
 for update skip locked
 limit 5;
```

### 3.5. Крон-нити

```sql
select cron.schedule('ads-launch-worker-minutely', '* * * * *', $$
  select net.http_post(
    url := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/ads-launch-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-automation-key', (select cron_secret from public.automation_settings where id = true)),
    body := jsonb_build_object('batch_size', 5));
$$);

select cron.schedule('ads-optimizer-morning', '0 5 * * *',  $$ … mode=morning $$);  -- 10:00 Алматы
select cron.schedule('ads-optimizer-night',   '0 17 * * *', $$ … mode=night   $$);  -- 22:00 Алматы
select cron.schedule('ads-token-health',      '0 */6 * * *',$$ … $$);               -- живость токенов
```

Ровно тот же паттерн, что у `capi-outbox-worker-minutely` — включая
`x-automation-key` и `verify_jwt = false` в `supabase/config.toml`.

### 3.6. Что переносится из `Parse JSON1` как есть

Чистые функции, без n8n-специфики — переезжают в `_lib/metaAds.ts` почти копипастой:

* `buildGeoLocations(city)` — резолв городов через Meta `/search`;
* `buildTargeting(cabinet)` — Advantage+ audience;
* `buildAdSetBody(goal, cabinet, budget)` / `buildCampaignBody(...)` / `buildCreativeBody(...)`;
* `buildNames(cabinet, service, format, goal, date, groupIndex)`;
* `resolveStartTime(tz)` — правило «до 12:00 → +2 мин, иначе следующая полночь»;
* `extractCodeWord(videoAnalysis, caption)`;
* `resolveLeadFormId(pageId, token)`.

Плюс из `Auto-Pause`: `countLeadsFromActions(actions)` (MAX внутри группы, суммирование
между источниками) — она уже дублирует `maxAction/sumActions` из `meta-daily-sync`,
пора свести в одну.

**Что можно НЕ переносить:**
`Carousel*` (11 нод — сборка альбома из Telegram; у сайта карусель приходит одним запросом),
`Convert GDrive Link`, `Cloudinary Upload GDrive`, `API Imgbb`, `Link_Reader`,
`Postgres Chat Memory` — это обвязка Telegram-входа, а не запуска с сайта.

### 3.7. Границы и как их обойти

| Ограничение | Решение |
|---|---|
| Время жизни edge-функции | один вызов = один шаг; долгое — через `awaiting_video` и следующий тик крона |
| Размер тела запроса (видео) | фронт грузит в Storage через существующий `r2-presign-upload`, воркер отдаёт Meta `file_url` — тело edge остаётся маленьким |
| Асинхронная обработка видео Meta | статус-поллинг шагом `awaiting_video` (в n8n это делает `Wait for Video Processing`) |
| Rate limit Meta | чтение `X-Business-Use-Case-Usage`, backoff, `batch_size` в кроне |
| Токен протух (#190) | `ads-token-health` каждые 6 ч → флаг на кабинете + алерт в Telegram (сейчас это ловится в `catch` внутри `Auto-Pause`) |
| Анализ креатива Gemini | опционально; для запуска с сайта не нужен — текст вводит менеджер. Оставить только для Telegram-входа |

### 3.8. Этапы

**Этап 0 — правки без миграции (полдня).** Снять кап $5; добавить политику записи
`ad_campaigns` для manager (или писать строку из edge сервисным ключом);
перестать считать таймаут успехом. Это чинит боль сегодня, ещё на n8n.

**Этап 1 — нативный запуск с сайта (основной объём).**
`ad_launch_jobs` + `ad_campaign_groups` + `_lib/metaAds.ts` + `ads-launch-worker` +
переписанный `launch-campaign` + крон. Флаг `automation_settings.ads_launch_native`:
`false` → старый путь в n8n, `true` → новый. Раскатка по одному кабинету.
n8n в это время продолжает обслуживать Telegram-вход.

**Этап 2 — оптимизатор.** `ads_optimizer_settings` + `ads-optimizer` + два крона.
Порты `Auto-Pause` и `Fetch Lead Quality`; отчёт в Telegram тот же.
Проверяется параллельным прогоном: n8n в dry-run, наш — боевой (или наоборот).

**Этап 3 — Telegram-вход и выключение n8n.** `ads-telegram-intake` (webhook бота),
карусель по `media_group_id`, Gemini-анализ. После — воркфлоу отключается,
`service_role` ключ и `callbackSecret` ротируются.

### 3.9. Что мы получаем

* Логика запуска в git, в одном месте, под ревью и типами — сейчас она в двух
  разошедшихся местах, одно из которых JSON в чужом UI.
* Прозрачные статусы: ошибка на любом шаге видна в интерфейсе.
* Идемпотентные ретраи вместо джиттера и «слепого ACK».
* Минус внешний хост в критическом пути — n8n лежит, реклама не запускается.
* Ротация ключей перестаёт быть страшной: сервисный ключ живёт в секретах Supabase.
* Пороги оптимизатора — настройка проекта, а не константа в чужом коде.
