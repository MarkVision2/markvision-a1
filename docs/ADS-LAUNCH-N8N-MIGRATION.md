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

### 3.8. Этапы и что уже сделано

**Этап 0 — сделано.** Три дефекта, из-за которых запуск с сайта либо не
работал, либо врал пользователю:
- фронт слал в `launch-campaign` publishable-ключ вместо JWT сессии, и
  `requireUser` отвечал 401 на каждый запуск — теперь идёт `access_token`;
- строку `ad_campaigns` писал браузер, а политика записи разрешает только
  admin — теперь её создаёт edge сервисным ключом до тяжёлых шагов;
- таймаут больше не выдаётся за успех: фронт проверяет строку запуска
  (`waitForLaunchRow`), edge помечает неподтверждённую отправку отдельным
  шагом, а недоступность обработчика — статусом `error` с текстом.

**Этап 1 — сделано.** Нативный запуск за флагом
`automation_settings.ads_launch_native` (по умолчанию `false`):
- `ad_launch_jobs` — очередь с результатом каждого шага;
- `ad_campaign_groups` + `claim_ad_campaign_group` — консолидация кампаний
  первичным ключом вместо случайной задержки;
- `claim_ad_launch_jobs` — забор заданий через `FOR UPDATE SKIP LOCKED`;
- `_lib/metaAds.ts`, `_lib/metaGeo.ts`, `_lib/metaGraph.ts` — тела запросов,
  гео и клиент Graph API с делением ошибок на временные и окончательные;
- `ads-launch-worker` — машина состояний, крон каждую минуту.

**Этап 2 — сделано.** Оптимизация на своих кронах:
- `ads_optimizer_settings` — пороги на проект вместо констант в чужом коде;
- `_lib/adsOptimizer.ts` — решения, подсчёт лидов, выгорание, отчёт;
- `ads-optimizer` + два крона (10:00 отчёт, 22:00 изменения).

**Этап 3 — код готов, переключение за владельцем.** Telegram-вход написан:
- `_lib/telegramLaunch.ts` — разбор подписи (направление, бюджет, сайт,
  кодовое слово, текст), целиком под тестами;
- `ads-telegram-intake` — webhook бота с проверкой секрета из `setWebhook`;
- `ad_telegram_media` + шаг `collect` в воркере — сборка альбома по
  `message_id`, уникальный ключ по `telegram_media_group_id` не даёт альбому
  из пяти фото создать пять кампаний;
- `ad_cabinet_websites` — белый список доменов для ссылок из подписи.

Не сделано намеренно: бот на этот webhook не переведён. Переключение рвёт
текущий поток в момент вызова `setWebhook`, а следом нужна ротация
сервисного ключа и секрета колбэка, которые лежат в теле нод n8n.

### 3.8.1. Что изменилось в поведении против n8n

- **Текст объявления не выдумывается.** В n8n его писал AI-агент. Без анализа
  креатива он сочинял бы цены и обещания, поэтому бот просит текст у человека
  и без него не запускает.
- **Связь лида с кампанией — по `leads.meta_campaign_id`**, а не по совпадению
  названия: переименование кампании больше не рвёт атрибуцию.
- **Ручной запуск оптимизатора ограничен одним кабинетом** и проверяет доступ
  вызывающего к его проекту. Обойти все кабинеты может только крон — функция
  меняет бюджеты и останавливает кампании.
- **«Ставьте плюсик» наконец распознаётся:** в n8n граница слова задавалась
  через `\b`, который для кириллицы не срабатывает.

### 3.9. Путь запуска с сайта — как он работает теперь

Нативный контур включён по умолчанию: мастер на сайте ходит прямо в Meta,
n8n в этой цепочке не участвует.

1. **Управление рекламой → Добавить кабинет.** Показываются все рекламные
   аккаунты токена — свои и клиентские из Business Manager, с пагинацией.
   Уже добавленные видны отдельным списком с пометкой.
2. **Создать рекламу → выбор кабинета.** Подтягиваются: список страниц
   Facebook, привязанный к странице Instagram, валюта и минимальный дневной
   бюджет кабинета. Под селектом — строка «подтянулось из Meta», где сразу
   видно, чего не хватает.
3. **Цель.** WhatsApp — номер подставляется сам; Сайт — пиксель и событие;
   Форма Meta — активная лид-форма. Везде приоритет у значения, сохранённого
   у кабинета, иначе единственное доступное, иначе разумный дефолт.
4. **Креатив и текст.** Фото/видео кропаются в браузере под 4:5 и 9:16,
   карусель — до десяти слайдов, либо продвижение готовой публикации Instagram.
5. **Запустить.** `launch-campaign` заводит строку запуска, грузит креативы
   в Meta, ставит задание в очередь и тут же прогоняет по нему воркер.
   В ответе — id кампании, группы и объявления; окно результата ведёт прямо
   в Ads Manager на созданную кампанию.

Бюджет вводится **в валюте кабинета**: Meta принимает `daily_budget` в её
минорных единицах, поэтому для счёта в тенге «50» — это 50 ₸, а не 50 $.
Валюта и минимум приходят из `kind=ad_account`, и мастер не даёт отправить
сумму ниже минимума.

Токен Meta резолвится на сервере (кабинет → проект → настройки → env) и
браузером не передаётся.

### 3.9.1. Как миграции попадают на прод

Таблицы этого набора уже на проде: файл `scripts/apply-ads-native-launch.sql`
(все четыре миграции одним идемпотентным куском) выполнен в SQL Editor.
Проверено запросом к PostgREST — `ad_launch_jobs`, `ad_campaign_groups`,
`ad_telegram_media`, `ad_cabinet_websites`, `ads_optimizer_settings` отвечают.

Отдельная история — почему до этого миграции вообще не доезжали. Секрет
`SUPABASE_DB_PASSWORD` задан, `db push` доходит до прода, но падал целиком на
расхождении истории: в `supabase_migrations.schema_migrations` записаны 86
версий без файлов в репозитории (применялись мимо CLI), а 72 локальных файла
применены к проду без записи в учёте. В таком состоянии CLI не применяет ни
одной миграции.

Воркфлоу `supabase-deploy` теперь чинит это сам:

1. `db push --dry-run`; если история расходится — версии без файлов помечаются
   `reverted` (список берётся из текста ошибки CLI);
2. версии из `supabase/migrations_baseline_applied.txt` помечаются `applied` —
   это файлы, уже применённые к проду мимо CLI; там же описано, как каждая
   проверялась;
3. оставшиеся «ранние» версии выполняются через `--include-all`, но только если
   перечислены в `supabase/migrations_out_of_order_ok.txt` — там же требования к
   идемпотентности; незнакомая версия останавливает деплой, потому что молча
   выполнить по проду произвольный старый SQL нельзя;
4. предохранитель: если план всё равно больше десяти миграций, не применяется
   ничего (порог — `DB_PUSH_MAX_PENDING`);
5. затем обычный `db push`.

Ремонт правит только служебную таблицу учёта, схема БД не трогается.

Запасной путь через Management API остаётся на случай, если секрет пароля
пропадёт; он отвечал `HTTP 403 (error code 1010)`, причина не подтверждена —
это ответ Cloudflare, а не Supabase.

### 3.9.2. Наблюдение и аварийный откат

```sql
-- очередь запусков
select launch_id, status, step, attempts, last_error, created_at
  from public.ad_launch_jobs order by created_at desc limit 20;

-- что видит менеджер в интерфейсе
select launch_id, status, status_step, status_message, meta_campaign_id
  from public.ad_campaigns order by created_at desc limit 20;

-- аварийный откат на n8n (штатно не нужен)
update public.automation_settings set ads_launch_native = false where id = true;
```

Telegram-вход подключается отдельно, когда решено уходить с n8n:

```bash
# 1. Секрет в Edge Secrets: TELEGRAM_ADS_WEBHOOK_SECRET, TELEGRAM_ADS_BOT_TOKEN
# 2. Перевести бота на наш обработчик (в этот момент n8n перестаёт получать апдейты)
curl "https://api.telegram.org/bot$TELEGRAM_ADS_BOT_TOKEN/setWebhook" \
  -d "url=$SUPABASE_URL/functions/v1/ads-telegram-intake" \
  -d "secret_token=$TELEGRAM_ADS_WEBHOOK_SECRET"

# откат на n8n — вернуть прежний URL той же командой
```

Оптимизатор можно прогнать вхолостую, ничего не меняя в кабинете:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/ads-optimizer" \
  -H "x-automation-key: $CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"mode":"night","dry_run":true,"cabinet_id":"<uuid>"}'
```

### 3.10. Что мы получаем

* Логика запуска в git, в одном месте, под ревью и типами — вместо двух
  разошедшихся копий, одна из которых JSON в чужом интерфейсе.
* Прозрачные статусы: ошибка на любом шаге видна менеджеру, а не тонет в
  вечном `queued`.
* Идемпотентные повторы вместо случайной задержки и «слепого ACK».
* Внешний хост уходит из критического пути: n8n лежит — реклама запускается.
* Пороги оптимизатора становятся настройкой проекта, а не константой.
* Дневной бюджет уходит в Meta таким, каким его ввёл менеджер.
