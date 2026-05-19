# ТЗ для Lovable: универсальный onboarding нового кабинета + автозапуск pipeline

## Контекст

В платформе уже задеплоен end-to-end pipeline сквозной атрибуции (PR #46):
- `meta_creatives` + `meta_creative_crm_daily` view — справочник креативов + воронка CRM
- `capi_outbox` + триггер `on_lead_stage_change_capi` — асинхронная отправка CAPI на каждом этапе CRM
- Edge functions: `capi-outbox-worker`, `meta-creative-upsert`, `greenapi-webhook`
- Таблица `crm_stage_map` — настраиваемый маппинг стадий
- Edge function `meta-validate-cabinet` — валидация Meta-токена и pixel_id

**Цель этого ТЗ:** сделать onboarding нового кабинета настолько умным, чтобы менеджер заполнил форму один раз — и весь pipeline (Meta API + GreenAPI + CAPI + n8n + лендинги) **начал работать без дополнительных шагов**.

---

## Что нужно сделать

### 1. Расширить форму «Добавить кабинет» (`SettingsConnection.tsx` или `useCabinetsStore.addCabinet`)

Сейчас форма принимает базовые поля. Нужно добавить недостающее и сгруппировать всё в логичные шаги мастера:

#### Шаг 1: Идентификация проекта и клиента
- **Имя кабинета** (`name`) — отображается в UI
- **Клиент / клиника** (`client_name`) — если ещё нет в `clients_config`, создать
- **Город** (`city`)
- **Валюта** (`currency`) — selector ₸ / $ / ₽ / € (записывается в `projects.currency`)
- **Часовой пояс** (`timezone`) — selector

#### Шаг 2: Meta Ads API (рекламный кабинет)
- **Ad Account ID** (`ad_account_id`) — формат `act_XXXXXXX` или просто число (автонормализация)
- **Access Token** (`access_token`) — long-lived system user token, обязательно
- **Pixel ID** (`pixel_id`)
- **Pixel Event** (`pixel_event`) — по умолчанию `Lead`, selector с `Lead | Schedule | Diagnostic | Purchase | CompleteRegistration`
- **CAPI Test Event Code** (`capi_test_event_code`) — опционально, для тестов в Events Manager
- **Кнопка «Проверить токен»** — вызывает `meta-validate-cabinet` edge function. Возвращает: имя аккаунта, валюта аккаунта, статус токена, активные кампании. Если ошибка — показать конкретную (token expired / no permission / wrong ad_account).

#### Шаг 3: Facebook Page + Instagram (для creative publishing)
- **Page ID** (`page_id`)
- **Page Name** (`page_name`) — заполняется автоматически после валидации
- **Instagram User ID** (`instagram_user_id`) — для cross-posting

#### Шаг 4: GreenAPI (WhatsApp)
- **Instance ID** (`wa_instance_id`)
- **API Token** (`wa_api_token`)
- **WhatsApp номер кабинета** (`whatsapp_number`) — `+7XXXXXXXXXX`
- **Кнопка «Проверить подключение»** — POST в `https://api.green-api.com/waInstance{id}/getStateInstance/{token}` → если `stateInstance=authorized` — зелёный чек.
- **Webhook URL** — отображается read-only с готовой ссылкой `https://<supabase>/functions/v1/greenapi-webhook` чтобы менеджер скопировал и вставил в GreenAPI Settings → Webhooks.
- Включить настройки webhooks в GreenAPI:
  - `incomingWebhook=yes`
  - `outgoingWebhook=yes`
  - `outgoingAPIMessageWebhook=yes`
  - `stateWebhook=yes`
  Это делается через `https://api.green-api.com/waInstance{id}/setSettings/{token}` POST — реализовать вызов из платформы.

#### Шаг 5: Лендинг и трекинг
- **Landing URL** (`website_url`) — основной лендинг проекта
- **Telegram Group ID** (`telegram_group_id`) — куда падают уведомления о лидах
- **Auto-generate UTM template** — сгенерировать готовую строку `?utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}` и показать кнопку «скопировать» — менеджер вставляет в Meta Ads Manager → Tracking template.
- **Generate inbound token** (`intake_token` для `projects`) — для приёма лидов из внешних форм. Показать готовый URL `https://<supabase>/functions/v1/lead-intake/t/<token>`.

#### Шаг 6: CRM Pipeline mapping
- Показать стадии текущего пайплайна проекта.
- Рядом с каждой стадией — selector «Какое CAPI событие отправлять?» (NULL / Schedule / Diagnostic / Purchase). По умолчанию автоопределяется через `crm_stage_map`, но можно переопределить для проекта.
- Сохранять в `crm_stage_map` с `project_id` (override глобальных правил).

#### Шаг 7: Финансовый план (опционально)
- Месячный план: spend / leads / CPL / visits / sales / revenue / avg check.
- Записывается в `finance_plans` для текущего месяца.

#### Шаг 8: Финальная проверка («Тестовый прогон»)
После заполнения формы — кнопка **«Запустить тестовую сборку»**. Платформа:
1. Создаёт тестовый лид в CRM с фейковым `meta_ad_id` → проверяет что `capi_outbox` получил событие `Lead`.
2. Переводит лид в стадию «Записан» → проверяет событие `Schedule`.
3. Переводит в «Диагностика» → событие `Diagnostic`.
4. Переводит в «Оплачено» с amount=10000 → событие `Purchase` с value.
5. Удаляет тестовый лид через 5 минут.
6. Показывает менеджеру: все ли события дошли до Meta (через test_event_code), статус каждого, время доставки.

---

### 2. На бэкенде: автоматизация при создании кабинета

После INSERT в `ad_cabinets` (через trigger или внутри `useCabinetsStore.addCabinet`):

1. **Создать дефолтный pipeline** для проекта если ещё нет (через `pipelines` + `pipeline_stages` со стандартными стадиями `new` / `no_answer` / `in_progress` / `invoice` / `scheduled` / `visit` / `paid` / `rejected`).
2. **Создать запись в `clients_config`** (зеркало для n8n) — это уже делает `useCabinetsStore.syncCabinetToClientConfig`, проверить что работает.
3. **Создать запись в `clients_secrets`** с fb_token, wa_api_token, wa_instance_id.
4. **Зарегистрировать webhook в GreenAPI** автоматически (вызов `setSettings` с нашим webhook URL) — через edge function `greenapi-setup`.
5. **Запустить первый `meta-daily-sync`** для этого кабинета — чтобы spend/leads появились в `cabinet_daily_insights` сразу, без ожидания следующего cron.
6. **Запустить `meta-structure-sync`** — подтянуть существующие кампании в `meta_campaigns` и креативы в `meta_creatives`.
7. **Создать row в `finance_plans`** для текущего месяца если ввёл план.

---

### 3. UI: статус подключений в шапке кабинета (Settings → Connections)

Сейчас есть `SettingsConnection.tsx`. Добавить визуальную панель «Health check» с 6 индикаторами:

| Индикатор | Что проверяет | Как |
|---|---|---|
| 🟢 Meta API | `access_token` валиден, есть permission на ad_account | вызов `meta-validate-cabinet` |
| 🟢 Pixel | `pixel_id` существует и связан с ad_account | `GET /{pixel_id}?access_token=...` |
| 🟢 WhatsApp | GreenAPI `stateInstance=authorized` | `GET /waInstance{id}/getStateInstance/{token}` |
| 🟢 CAPI worker | за последние 24ч есть `sent` события | `SELECT count(*) FROM capi_outbox WHERE status='sent' AND sent_at > now() - interval '24 hours'` |
| 🟢 Creative sync | последний `meta-structure-sync` < 2ч назад | `SELECT max(created_at) FROM ad_sync_runs WHERE cabinet_id=? AND ok=true` |
| 🟢 CRM events | за последние 24ч сменилось стадий | `SELECT count(*) FROM lead_status_history WHERE changed_at > now() - interval '24 hours'` |

Каждый индикатор — кликабельный. Клик открывает popover с деталями и кнопкой «Починить» если возможно.

---

### 4. UI: страница «Воронка по креативам» (`CreativeFunnel.tsx`)

Расширить существующую страницу до полной воронки **«Креатив → Показы → Клики → Лиды CRM → Диагностики → Оплаты → Выручка → ROMI»** для каждого креатива:

- **Карточка креатива** сверху: превью, текст, CTA, дата запуска, статус (ACTIVE / PAUSED), бюджет в день.
- **5-этапная воронка** с конверсиями между этапами (CTR клик→показ, CR клик→лид, CR лид→диагностика, CR диагностика→оплата).
- **Дневной график** spend vs revenue.
- **Таблица лидов** по этому креативу (имя, телефон, источник, стадия, amount).
- **Топ возражений** по этому креативу (из `mark_objections_log` если есть).
- **AI-инсайт** — кнопка «Спросить AI: почему этот креатив не конвертирует?» → вызывает `report-ai-chat`.

---

### 5. UI: страница «Pipeline Status» (новая, опционально)

Дашборд для админа — состояние всего pipeline в реальном времени:
- Сколько событий в `capi_outbox` со статусами pending / sent / failed
- Последние 10 failed событий с причинами
- Сколько лидов без `meta_ad_id` за последние 7 дней (orphan rate)
- Сколько лидов без `cabinet_id` (warning: куда они должны быть привязаны)
- График отправок CAPI по часам

---

### 6. Документация в платформе

В разделе «Помощь» добавить страницу «Как настроить новый проект» с пошаговыми скриншотами (можно из существующего `docs/SETUP-CHECKLIST.md`):
- Где взять Meta System User Token
- Где взять Pixel ID
- Как настроить GreenAPI instance
- Как создать Custom Conversion «Diagnostic» в Meta Events Manager
- Как добавить tracking template в Meta Ads Manager
- Как добавить snippet на лендинг (готовый код)

---

## Технические требования

### Безопасность
- Все секреты (`access_token`, `wa_api_token`, `fb_token`) хранить **зашифрованно** в `clients_secrets` (Supabase Vault если возможно) — НЕ в `ad_cabinets.access_token` plain text.
- RLS на `clients_secrets`: только admin + project members могут читать токены своего проекта.
- На фронте — никогда не отображать токен после сохранения, только маскировано (`••••••••XYZ`).
- В UI отображать «Last validated: X minutes ago» — пользователь видит свежесть проверки.

### UX
- Все шаги мастера — с валидацией в реальном времени (на каждом шаге кнопка «Далее» неактивна пока поле не валидно).
- На каждом шаге — короткая объясняющая видеоподсказка или скриншот «как это получить».
- При ошибке валидации — конкретное сообщение («Этот ad_account уже добавлен в проект X», «Pixel не связан с этим ad_account», «Токен истёк»).
- Финальный шаг с тестовым прогоном — анимированный progress: «Создаю тестовый лид...» → «Проверяю CAPI...» → «✅ Готово, всё работает».

### Производительность
- `meta-validate-cabinet` и `setSettings` GreenAPI вызывать в фоне (toast уведомление по результату).
- Не блокировать сохранение кабинета при ошибке валидации — сохранить с пометкой `validation_failed_at`, показать red badge в списке.

### Multi-tenant
- Каждый кабинет привязан к `project_id`. Кабинет одного проекта не должен видеть данные другого.
- При создании пользователь — admin своего проекта автоматически.
- Если у пользователя несколько проектов — selector проектов в шапке.

---

## База данных: миграции

Если каких-то полей в `ad_cabinets` ещё нет, добавить:

```sql
ALTER TABLE public.ad_cabinets
  ADD COLUMN IF NOT EXISTS pixel_id text,
  ADD COLUMN IF NOT EXISTS pixel_event text DEFAULT 'Lead',
  ADD COLUMN IF NOT EXISTS capi_test_event_code text,
  ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validation_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_error text,
  ADD COLUMN IF NOT EXISTS health_check_at timestamptz;
```

---

## Что НЕ делать в этой итерации

- Не делать редизайн остальных страниц (Dashboard / Metrics / Analytics) — там цифры уже согласованы (PR #45).
- Не трогать n8n воркфлоу `AI-targetolog1` — туда добавим узел вручную (готовый JSON в `docs/SETUP-CHECKLIST.md`).
- Не делать UI для редактирования `crm_stage_map` глобально — только override для конкретного проекта в шаге 6.

---

## Definition of Done

- [ ] Менеджер заходит в платформу → жмёт «Добавить новый проект»
- [ ] Проходит 8 шагов мастера, заполняя только нужные поля
- [ ] На каждом шаге видит подсказки «как получить эти данные»
- [ ] Финальный тестовый прогон показывает что pipeline работает end-to-end
- [ ] В Dashboard / Metrics / Analytics / CreativeFunnel сразу появляются данные нового проекта (после первой синхронизации)
- [ ] Никакого ручного SQL / Supabase Dashboard / Edge functions деплоя НЕ требуется — всё через UI
- [ ] Health check в шапке кабинета показывает 6 зелёных индикаторов

---

## Связанные файлы (для контекста)

- `src/hooks/useCabinetsStore.ts` — текущая логика add/update кабинета
- `src/pages/SettingsConnection.tsx` — текущий UI настроек
- `src/integrations/supabase/types.ts` — типы БД (`ad_cabinets`, `clients_config`, `clients_secrets`)
- `supabase/functions/meta-validate-cabinet/index.ts` — валидация Meta API
- `supabase/functions/greenapi-webhook/index.ts` — приём WhatsApp
- `supabase/functions/meta-creative-upsert/index.ts` — endpoint для n8n при создании креатива
- `supabase/functions/capi-outbox-worker/index.ts` — воркер CAPI
- `supabase/migrations/20260519100000_capi_outbox_and_attribution.sql` — миграция pipeline
- `docs/SETUP-CHECKLIST.md` — ручные шаги (которые после этого ТЗ должны исчезнуть)
- `docs/attribution-pipeline.md` — архитектура pipeline
