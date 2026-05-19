# 🚀 Чек-лист: запуск сквозной аналитики креатив → CAPI

Этот документ — твой пошаговый план. После выполнения всех пунктов система начнёт работать end-to-end для **всех существующих и новых проектов**.

---

## ✅ Шаг 0. Дождаться merge PR #46

После того как PR смержится в `main`, Vercel задеплоит фронтенд, а Supabase нужно деплоить вручную (миграция + edge functions).

---

## ✅ Шаг 1. Сгенерированные ключи

Реальные значения ключей сгенерированы и переданы тебе в чате (или сгенерируй заново через `openssl rand -hex 32`). В этот публичный документ значения не кладём — это сами по себе bearer secrets.

```
CREATIVE_UPSERT_KEY=<64-hex-chars, см. чат>
CAPI_WORKER_KEY=<64-hex-chars, см. чат>
```

**Что с ними сделать:**

1. Supabase Dashboard → Project Settings → Edge Functions → Secrets
2. Add new secret → `CREATIVE_UPSERT_KEY` = `<значение из чата>`
3. Add new secret → `CAPI_WORKER_KEY` = `<значение из чата>`

⚠ Тот же `CREATIVE_UPSERT_KEY` должен стоять в узле `Save Ad Creative` в n8n workflow `AI-targetolog1` (header `x-creative-key`). Тот же `CAPI_WORKER_KEY` — в pg_cron job (header `x-cron-key`).

**Опциональные fallback-секреты** (если кабинет не настроен в `ad_cabinets`):
4. `META_ACCESS_TOKEN` = твой системный токен Meta для проекта MarkVision
5. `META_DEFAULT_PIXEL_ID` = твой дефолтный pixel_id

---

## ✅ Шаг 2. Применить миграцию

```bash
cd ~/markvision-a1
supabase db push
# или вручную через Supabase Dashboard → SQL Editor → вставить содержимое 20260519100000_capi_outbox_and_attribution.sql
```

После миграции в БД появятся:
- `capi_outbox` (очередь событий)
- `crm_stage_map` (маппинг стадий, уже заполнен русскими и английскими вариантами)
- Триггеры на `leads.stage_id` и `deals.status`
- Обновлённый view `meta_creative_crm_daily` (теперь с override на `manual_revenue`)
- Бэкфилл всех существующих paid лидов в очередь

---

## ✅ Шаг 3. Задеплоить edge functions

```bash
supabase functions deploy capi-outbox-worker
supabase functions deploy meta-creative-upsert
supabase functions deploy greenapi-webhook   # обновлённая версия
```

---

## ✅ Шаг 4. Прописать pg_cron job для CAPI воркера

Supabase Dashboard → Database → Extensions → включить `pg_cron` и `pg_net` (если не включены). Затем SQL Editor:

```sql
SELECT cron.schedule(
  'capi-outbox-worker',
  '* * * * *',   -- каждую минуту
  $$
  SELECT net.http_post(
    url := 'https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/capi-outbox-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', '<CAPI_WORKER_KEY значение из чата>'
    ),
    body := jsonb_build_object('batch_size', 50)
  );
  $$
);
```

Заменить `mekwfbqmsqiborjdrjxc` на твой реальный SUPABASE_PROJECT_ID если другой.

**Проверка:**
```sql
SELECT * FROM cron.job WHERE jobname = 'capi-outbox-worker';
```

---

## ✅ Шаг 5. n8n воркфлоу AI-targetolog1 — добавить узел Save Ad Creative

⚠️ **НЕ трогать workflow «AI-targetolog Макс 1»** — только `AI-targetolog1`.

### Шаги:

1. Открыть n8n: https://n8n.zapoinov.com
2. Найти workflow `AI-targetolog1` (ID: `LncxAleDlMPOb3hP`)
3. Кликнуть после узла **`Save Ad Creative`** (он уже есть, это Code узел) — добавить новый узел
4. Тип узла: **HTTP Request**
5. Имя: `Upsert to Markvision DB`
6. Параметры:

```
Method:  POST
URL:     https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/meta-creative-upsert

Headers:
  Content-Type:      application/json
  x-creative-key:    <CREATIVE_UPSERT_KEY значение из чата>

Body (JSON):
{
  "ad_id": "={{ $('Extract AdSet ID1').item.json.id }}",
  "adset_id": "={{ $('Extract AdSet ID').item.json.id }}",
  "campaign_id": "={{ $('Extract Campaign ID').item.json.id }}",
  "ad_account_id": "={{ $('Supabase — Get Client Config').item.json.ad_account_id }}",
  "project_id": "={{ $('Supabase — Get Client Config').item.json.project_id }}",
  "name": "={{ $('Save Ad Creative').item.json.name || $('AI Agent Креатор').item.json.name }}",
  "thumbnail": "={{ $('Save Ad Creative').item.json.thumbnail || $('Get Video Thumbnail').item.json.url }}",
  "primary_text": "={{ $('AI Agent Креатор').item.json.text }}",
  "headline": "={{ $('AI Agent Креатор').item.json.headline }}",
  "cta": "={{ $('AI Agent Креатор').item.json.cta }}",
  "destination": "WHATSAPP",
  "objective": "OUTCOME_LEADS",
  "effective_status": "ACTIVE"
}
```

> Если каких-то полей нет в твоём workflow (например `Get Video Thumbnail`) — просто оставь `null`, главные обязательные поля это `ad_id`, `adset_id`, `campaign_id`, `ad_account_id`.

Соедини этот узел стрелкой после `Save Ad Creative` (или после `Create Ad` → `Extract AdSet ID1` если `Save Ad Creative` не везде запускается).

**Сохрани и активируй workflow.**

---

## ✅ Шаг 6. Custom event «Diagnostic» в Meta (НЕ обязательно!)

**Если просто хотим, чтобы Meta принимала событие** — ничего делать не нужно. CAPI worker сам отправит `event_name=Diagnostic`, и Meta автоматически добавит его в список Custom Events.

**Если хотим оптимизировать кампании под «Diagnostic»** — нужно создать Custom Conversion (Меta-аналог «цели»):

1. Meta Events Manager → https://business.facebook.com/events_manager2/
2. Выбрать Pixel (твой MarkVision)
3. Custom Conversions → Create
4. Name: `Diagnostic — клиника`
5. Event = `Diagnostic` (custom event)
6. Description: «Лид прошёл диагностику»
7. Save

После этого можно настраивать кампании с целью `Custom Conversion: Diagnostic` — Meta будет оптимизировать показ под визиты на диагностику.

---

## ✅ Шаг 7. Лендинги: Pixel дедуп с CAPI (универсально, делается один раз)

Это нужно для **всех** лендингов всех клиентов. Добавить в head или перед `</body>`:

```html
<script>
// Получить URL params + cookies
function getParam(n) { return new URLSearchParams(location.search).get(n); }
function getCookie(n) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

// Сохранить fbclid в cookie на 90 дней (Meta стандарт)
const fbclid = getParam('fbclid');
if (fbclid) {
  const fbc = `fb.1.${Date.now()}.${fbclid}`;
  document.cookie = `_fbc=${fbc}; max-age=${90*86400}; path=/; samesite=Lax`;
}

// При submit формы — генерим event_id и шлём в Pixel + lead-intake одновременно
window.submitLead = async function(formData) {
  const eventId = crypto.randomUUID();

  // 1) Pixel событие (клиентское)
  if (window.fbq) {
    fbq('track', 'Lead', { currency: 'KZT' }, { eventID: eventId });
  }

  // 2) CAPI событие через наш lead-intake (серверное)
  await fetch('https://mekwfbqmsqiborjdrjxc.supabase.co/functions/v1/lead-intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: formData.name,
      phone: formData.phone,
      email: formData.email,
      utm_source: getParam('utm_source'),
      utm_medium: getParam('utm_medium'),
      utm_campaign: getParam('utm_campaign'),
      utm_content: getParam('utm_content'),  // тут должен лететь {{ad.id}} из Meta
      utm_term: getParam('utm_term'),
      fbclid: getParam('fbclid'),
      fbc: getCookie('_fbc'),
      fbp: getCookie('_fbp'),
      fb_event_id: eventId,                  // ВАЖНО — дедуп с pixel
      referrer: document.referrer,
      landing_url: location.href,
      project_id: 'YOUR_PROJECT_UUID',       // ОБЯЗАТЕЛЬНО для лендинга проекта
    }),
  });
};
</script>
```

### Tracking template в Meta Ads Manager

В каждой рекламной кампании поставить URL parameters:

```
utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}
```

Это даст автоматическую атрибуцию каждого клика к креативу.

---

## ✅ Шаг 8. Кнопка WhatsApp на сайтах (универсально)

Для CTWA-кнопки на сайтах добавить:

```html
<button onclick="openWhatsApp('77001234567')">Написать в WhatsApp</button>
<script>
async function openWhatsApp(phoneNumber) {
  const clickId = crypto.randomUUID();
  // Записываем клик до редиректа — на случай если referral от Meta не придёт
  fetch('https://mekwfbqmsqiborjdrjxc.supabase.co/rest/v1/wa_clicks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': 'YOUR_SUPABASE_ANON_KEY',
      'Authorization': 'Bearer YOUR_SUPABASE_ANON_KEY'
    },
    body: JSON.stringify({
      click_id: clickId,
      utm_source: new URLSearchParams(location.search).get('utm_source'),
      utm_content: new URLSearchParams(location.search).get('utm_content'),
      utm_campaign: new URLSearchParams(location.search).get('utm_campaign'),
      utm_term: new URLSearchParams(location.search).get('utm_term'),
      fbclid: new URLSearchParams(location.search).get('fbclid'),
      page_url: location.href,
    }),
  });
  // В text-приветствии короткий хвост click_id чтобы можно было matched-ить
  window.location.href = `https://wa.me/${phoneNumber}?text=Заявка%20%23${clickId.slice(0,8)}`;
}
</script>
```

---

## ✅ Шаг 9. Проверка работы

```sql
-- 1) Проверить что миграция применилась
SELECT count(*) FROM crm_stage_map;  -- должно быть >= 26 (русские + английские варианты)
SELECT count(*) FROM capi_outbox WHERE status = 'pending';

-- 2) После запуска тестовой кампании — проверить креатив
SELECT * FROM meta_creatives ORDER BY updated_at DESC LIMIT 5;

-- 3) После CTWA-сообщения — проверить лид
SELECT id, name, phone, meta_ad_id, source FROM leads ORDER BY created_at DESC LIMIT 5;

-- 4) После смены стадии — проверить очередь
SELECT id, event_name, status, attempts, last_error FROM capi_outbox ORDER BY created_at DESC LIMIT 10;

-- 5) После работы pg_cron — проверить отправку
SELECT status, count(*) FROM capi_outbox GROUP BY status;
```

---

## Архитектура для понимания

```
┌─────────────────────────────────────────────────────────────────┐
│ ЕДИНЫЙ PIPELINE — работает для ВСЕХ проектов автоматически      │
└─────────────────────────────────────────────────────────────────┘

[n8n: AI-targetolog1]
   │
   │ HTTP POST → meta-creative-upsert
   ▼
[meta_creatives] ← мгновенно после Create Ad
   │
   ▼
[Meta показывает рекламу]
   │
   ├─ Клик на CTWA → [greenapi-webhook] → wa_clicks + leads
   └─ Клик на сайт → [lead-intake] → leads (с meta_ad_id из utm_content)
   │
   ▼
[Этапы CRM]
   │
   │ trigger on_lead_stage_change_capi
   ▼
[capi_outbox] ← pending
   │
   │ pg_cron каждую минуту → POST /capi-outbox-worker
   ▼
[Meta CAPI: Schedule / Diagnostic / Purchase]
   │
   ▼
[meta_creative_crm_daily view] ← override-aware
   │
   ▼
[CreativeFunnel UI]
```

---

## Что я НЕ могу сделать сам (нужно сделать тебе)

| Что | Где | Почему я не могу |
|---|---|---|
| Положить секреты в Supabase | Dashboard → Project Settings → Edge Functions | MCP не даёт доступ к secrets |
| Применить миграцию | `supabase db push` или Dashboard SQL Editor | Нет CLI доступа из MCP |
| Задеплоить edge functions | `supabase functions deploy` | То же |
| Прописать pg_cron | Dashboard SQL Editor (одной строкой) | Нет прав на cron schema через MCP |
| Добавить узел в n8n | n8n UI (https://n8n.zapoinov.com) | MCP даёт только read доступ к workflows, не write |
| Custom Conversion в Meta | Events Manager UI | Только UI, не API |
| Snippet на лендинги | Tilda / клиентский сайт | Доступа к лендингам нет |

Всё остальное — в коде, уже сделано в PR #46.