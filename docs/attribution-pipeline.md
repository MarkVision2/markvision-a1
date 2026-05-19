# Сквозная атрибуция: креатив → лид → CRM-этап → CAPI

Этот документ описывает, как соединены три части pipeline и что нужно настроить в n8n / на лендинге, чтобы система работала end-to-end.

## Архитектура

```
[n8n AI-targetolog] ─────► [Edge: meta-creative-upsert] ─────► [meta_creatives table]
       │                                                              │
       │ создаёт Campaign/AdSet/Ad в Meta                              │
       ▼                                                               │
[Meta показывает рекламу]                                              │
       │                                                               │
       ├─ CTWA (кнопка WhatsApp)                                       │
       │       │                                                       │
       │       └──► [Edge: greenapi-webhook] ──► парсит referral ─────┤
       │                  │                                             │
       │                  └──► wa_clicks + leads (с meta_ad_id) ────────┤
       │                                                                │
       └─ Сайт с UTM + Pixel                                             │
              │                                                          │
              └──► [Edge: submit-lead] ──► leads (с meta_ad_id) ─────────┤
                                                                          ▼
                                                       [trigger leads_stage_capi]
                                                                          │
                                              на каждом этапе CRM ────────┤
                                                                          │
                                                                          ▼
                                                              [capi_outbox queue]
                                                                          │
                                                                cron → ───┤
                                                                          ▼
                                                       [Edge: capi-outbox-worker]
                                                                          │
                                                                          ▼
                                                       [Meta CAPI: Schedule /
                                                        Diagnostic / Purchase]
                                                                          │
                                                                          ▼
                                                       [meta_creative_crm_daily view]
                                                                          │
                                                                          ▼
                                                       [Воронка по креативам в UI]
```

## Шаги настройки

### 1. n8n воркфлоу AI-targetolog: сохранение креатива

После публикации рекламы в Meta (узел `Create Ad`) добавьте HTTP Request узел `Save Ad Creative` который вызывает наш endpoint:

**URL:** `https://<SUPABASE_PROJECT>.functions.supabase.co/meta-creative-upsert`

**Headers:**
```
x-creative-key: <значение CREATIVE_UPSERT_KEY из supabase secrets>
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "ad_id": "{{ $('Extract AdSet ID1').item.json.id }}",
  "adset_id": "{{ $('Extract AdSet ID').item.json.id }}",
  "campaign_id": "{{ $('Extract Campaign ID').item.json.id }}",
  "name": "{{ $('Save Ad Creative').item.json.name }}",
  "project_id": "{{ $('Supabase — Get Client Config').item.json.project_id }}",
  "cabinet_id": "{{ $('Supabase — Get Client Config').item.json.cabinet_id }}",
  "ad_account_id": "{{ $('Supabase — Get Client Config').item.json.ad_account_id }}",
  "thumbnail": "{{ $('AI Agent Креатор').item.json.thumbnail }}",
  "landing_url": "{{ $('AI Agent Креатор').item.json.landing_url }}",
  "primary_text": "{{ $('AI Agent Креатор').item.json.text }}",
  "headline": "{{ $('AI Agent Креатор').item.json.headline }}",
  "cta": "{{ $('AI Agent Креатор').item.json.cta }}",
  "format": "{{ $('AI Agent Креатор').item.json.format }}",
  "destination": "WHATSAPP",
  "objective": "OUTCOME_LEADS"
}
```

Идемпотентность: повторный вызов с тем же `ad_id` обновит существующую строку, не создаст дубль.

### 2. Лендинг: Pixel дедуп с CAPI

На странице, где пользователь оставляет заявку, при submit формы:

```js
// Генерируем event_id для дедупликации с CAPI
const eventId = crypto.randomUUID();

// Pixel событие
fbq('track', 'Lead', { value: 0, currency: 'KZT' }, { eventID: eventId });

// При отправке формы — передаём этот же event_id и fbclid в lead-intake
fetch('https://<SUPABASE_PROJECT>.functions.supabase.co/lead-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: formData.name,
    phone: formData.phone,
    utm_source: getURLParam('utm_source'),
    utm_medium: getURLParam('utm_medium'),
    utm_campaign: getURLParam('utm_campaign'),
    utm_content: getURLParam('utm_content'),  // ВАЖНО: должен содержать {{ad.id}}
    utm_term: getURLParam('utm_term'),
    fbclid: getURLParam('fbclid'),
    fbc: getCookie('_fbc'),
    fbp: getCookie('_fbp'),
    fb_event_id: eventId,  // дедуп с pixel
    referrer: document.referrer,
    landing_url: window.location.href,
  }),
});
```

**Tracking template в Meta:** `?utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}&fbclid={{fbclid}}`

### 3. Кнопка WhatsApp на сайте

Перед редиректом на wa.me — пишем в `wa_clicks` (через отдельный публичный endpoint или прямо из браузера через RPC). Это нужно чтобы matching работал, даже если CTWA-referral не пришёл в первое сообщение.

```js
async function openWhatsApp(phoneNumber) {
  const clickId = crypto.randomUUID();
  await supabase.from('wa_clicks').insert({
    click_id: clickId,
    utm_source: getURLParam('utm_source'),
    utm_content: getURLParam('utm_content'),  // ad_id
    utm_campaign: getURLParam('utm_campaign'),
    utm_term: getURLParam('utm_term'),
    fbclid: getURLParam('fbclid'),
    fbp: getCookie('_fbp'),
    fbc: getCookie('_fbc'),
    page_url: window.location.href,
  });
  // Передаём click_id в text, чтобы можно было заматчить в первом сообщении
  window.location.href = `https://wa.me/${phoneNumber}?text=Заявка%20%23${clickId.slice(0,8)}`;
}
```

### 4. CAPI worker: cron

Edge function `capi-outbox-worker` нужно запускать каждую минуту. В Supabase Dashboard → Database → Extensions включить `pg_cron`, затем:

```sql
SELECT cron.schedule(
  'capi-outbox-worker',
  '* * * * *',  -- каждую минуту
  $$
  SELECT net.http_post(
    url := 'https://<SUPABASE_PROJECT>.functions.supabase.co/capi-outbox-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', '<CAPI_WORKER_KEY>'
    ),
    body := jsonb_build_object('batch_size', 50)
  );
  $$
);
```

Альтернатива через n8n: schedule trigger каждую минуту → HTTP Request на тот же endpoint.

### 5. Meta Events Manager — custom event «Diagnostic»

Один раз нужно создать custom event в Meta Events Manager:

1. Зайти в Events Manager → выбрать Pixel
2. Custom Events → Create custom event → name = `Diagnostic`
3. Назначить как «диагностика» / «визит к врачу» для атрибуции

После этого Meta будет понимать ваш кастомный signal и оптимизировать кампании под него.

## Секреты, которые нужно положить в Supabase

```bash
supabase secrets set CREATIVE_UPSERT_KEY=<длинная_случайная_строка>
supabase secrets set CAPI_WORKER_KEY=<длинная_случайная_строка>
# Опционально — fallback токен, если в кабинете не настроен:
supabase secrets set META_ACCESS_TOKEN=<system_user_token>
supabase secrets set META_DEFAULT_PIXEL_ID=<пиксель_по_умолчанию>
```

## Маппинг стадий CRM → CAPI

Таблица `crm_stage_map` хранит правила. Из коробки замаппены русские и английские варианты:

| Стадия (стейдж-ключ) | CAPI событие | is_paid |
|---|---|---|
| `scheduled`, `записан`, `запись`, `счёт`, `invoice` | `Schedule` | false |
| `diagnostic`, `diagnosed`, `visit`, `диагностика`, `визит` | `Diagnostic` | false |
| `paid`, `purchase`, `won`, `оплачено`, `продажа` | `Purchase` | true |

Если у клиента нестандартное имя стадии — добавить строку:

```sql
INSERT INTO crm_stage_map (status_key, capi_event, is_paid, project_id)
VALUES ('первичная_консультация', 'Diagnostic', false, '<project_uuid>');
```

`project_id` опциональный — если NULL, правило применяется ко всем проектам. Если задан — переопределяет глобальное.

## Что увидите в UI

- **CreativeFunnel** (`/creative-funnel`) — полная воронка по каждому креативу: лиды → квалификация → продажи → выручка → ROMI. Данные через view `meta_creative_crm_daily` с override `manual_revenue`.
- **capi_outbox** — таблица событий (можно сделать админку). Realtime подписка показывает статус отправки в Meta.

## Диагностика

```sql
-- Сколько событий зависло pending больше 5 минут — индикатор проблем с CAPI токеном
SELECT event_name, count(*), max(attempts) as max_attempts
FROM capi_outbox
WHERE status = 'pending' AND created_at < now() - interval '5 minutes'
GROUP BY event_name;

-- Quality атрибуции: сколько paid лидов с meta_ad_id vs без
SELECT
  count(*) FILTER (WHERE paid AND meta_ad_id IS NOT NULL) as attributed,
  count(*) FILTER (WHERE paid AND meta_ad_id IS NULL) as orphan
FROM leads
WHERE created_at > now() - interval '30 days';

-- Креативы с самой низкой стоимостью продажи
SELECT mc.name, mc.ad_id,
       sum(d.crm_sales) as sales,
       sum(d.crm_revenue) as revenue
FROM meta_creative_crm_daily d
JOIN meta_creatives mc ON mc.ad_id = d.ad_id
WHERE d.date > now() - interval '30 days'
GROUP BY mc.id, mc.name, mc.ad_id
HAVING sum(d.crm_sales) > 0
ORDER BY sum(d.crm_revenue) DESC;
```
