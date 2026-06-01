# Pipeline сквозной аналитики органического контента

Как замкнуть «код-слово под Reel → DM → клик → лид в CRM → продажа», чтобы каждое звено пробивалось автоматически и было видно в `/analytics/content`.

## Архитектура

```
[Instagram Reel]
       │
       │ зритель пишет код-слово в DM
       ▼
[n8n / GreenAPI / IG webhook]
       │
       │ POST /functions/v1/instagram-organic-intake
       │     { event_type: 'codeword_dm', codeword, username, reel_url, token }
       ▼
[instagram_organic_events]  ← запись DM
       │
       │ бот отвечает короткой ссылкой
       │ https://<SUPABASE>.functions.supabase.co/ig-organic-redirect?c=<short_id>&u=<username>
       ▼
[Пользователь кликает]
       │
       ▼
[Edge: ig-organic-redirect]   ← новое
       │  1) resolve short_id → codeword + target_url
       │  2) insert link_click event
       │  3) 302 → target_url + ?utm_source=instagram&utm_campaign=<codeword>&cw=<codeword>
       ▼
[Лендинг с формой]
       │  hidden input cw=<codeword> (берётся из ?cw= в URL)
       ▼
[Edge: lead-intake]   ← обновлено: принимает codeword/cw/utm_campaign
       │  1) создаёт lead в CRM
       │  2) пишет 3-е событие 'lead' в instagram_organic_events (lead_id, codeword_id)
       ▼
[CRM-этап → paid=true, amount]
       │
       ▼
[view instagram_codeword_stats]
       └── join leads по lead_id из событий типа 'lead'
       └── sales = COUNT(paid), revenue = SUM(amount where paid)
                 │
                 ▼
       [страница /analytics/content]
```

## Что уже в репозитории

| Слой | Файл | Что делает |
|---|---|---|
| Миграция БД | `supabase/migrations/20260513070717_multi_provider_and_instagram_organic.sql` | Базовые таблицы и view |
| Миграция БД | `supabase/migrations/20260601164950_ig_organic_content_analytics.sql` | `short_id`, RLS для участников проекта, обогащённый `instagram_codeword_stats` с продажами/выручкой, `instagram_reel_daily`, RPC `resolve_codeword_short` |
| Edge fn | `supabase/functions/instagram-organic-intake/index.ts` | Webhook для DM-событий от n8n/GreenAPI |
| Edge fn | `supabase/functions/ig-organic-redirect/index.ts` | Короткий редирект-эндпоинт, фиксирует `link_click` |
| Edge fn | `supabase/functions/lead-intake/index.ts` | Лид-интейк лендинга; принимает `codeword`/`cw` и пишет `lead`-событие |
| React | `src/hooks/useInstagramOrganic.ts` | `useInstagramOrganic`, `useCodewordStats`, `useInstagramCodewords`, `useCodewordLeads` |
| React | `src/pages/ContentAnalytics.tsx` | Страница `/analytics/content` |

## Шаги настройки

### 1. Применить миграцию

```bash
supabase db push      # локально
# или через Supabase dashboard → SQL editor → запустить файл миграции
```

После миграции у всех существующих code-words будет `short_id`, у view появятся колонки `sales`/`revenue`/`unique_users`.

### 2. Задеплоить edge-функции

```bash
supabase functions deploy ig-organic-redirect --no-verify-jwt
supabase functions deploy instagram-organic-intake --no-verify-jwt
supabase functions deploy lead-intake --no-verify-jwt
```

`--no-verify-jwt` обязательно — это публичные эндпоинты. Они авторизуются своим способом (intake-токен / короткий ID).

### 3. В UI создать код-слова

Откройте `/analytics/content` → «Добавить код-слово»:
- **Код-слово**: `smile` (как зритель должен написать в DM).
- **Reel URL**: ссылка на конкретный Reel.
- **Target URL**: страница оффера, куда вести.
- (опц.) превью и подпись.

После сохранения в таблице доступна короткая ссылка: `https://<SUPABASE>.functions.supabase.co/ig-organic-redirect?c=<short_id>`. **Эту ссылку отдаёт бот в DM.**

### 4. Настроить n8n / IG-бот

Узел, который ловит DM от подписчика:

```http
POST https://<SUPABASE>.functions.supabase.co/instagram-organic-intake
Headers:
  Content-Type: application/json
  x-intake-token: <project_intake_token>   # из Settings → Подключения
Body:
{
  "event_type": "codeword_dm",
  "codeword": "{{ $json.codeword }}",       # извлечённое из текста DM
  "username": "{{ $json.from.username }}",
  "contact": "{{ $json.from.phone }}",      # опц.
  "reel_url": "{{ $json.story_url }}",      # если знаешь конкретный Reel
  "payload": { "raw": "{{ $json.text }}" }
}
```

Дальше бот отвечает шаблоном:
> Спасибо! Лови ссылку: `https://…/ig-organic-redirect?c=<short_id>&u=<username>`

`short_id` берём из таблицы `instagram_codewords` (n8n-узел Supabase `select short_id where codeword = $codeword`).

### 5. Лендинг — hidden поле `cw`

На форме лендинга добавь скрытый input, в который JS подставляет значение `cw` из querystring:

```html
<form id="lead">
  <input type="hidden" name="cw" id="cw">
  <input name="name" required>
  <input name="phone" required>
  <input name="_hp" style="display:none" autocomplete="off"><!-- honeypot -->
  <button type="submit">Оставить заявку</button>
</form>

<script>
  // 1. подставляем cw из URL
  const url = new URL(location.href);
  document.getElementById('cw').value = url.searchParams.get('cw') ?? '';

  // 2. отправка на lead-intake
  document.getElementById('lead').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.landing_url = location.href;
    data.referrer = document.referrer;
    await fetch('https://<SUPABASE>.functions.supabase.co/lead-intake/t/<PROJECT_TOKEN>', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    location.href = '/thanks';
  });
</script>
```

`<PROJECT_TOKEN>` берётся в Settings → Подключения (или формуле `projects.intake_token`).

### 6. Проверка

После прохода первого «настоящего» зрителя по воронке:

```sql
-- Видно ли событие DM
select event_type, codeword, username, occurred_at
  from instagram_organic_events
  order by occurred_at desc limit 10;

-- Полная воронка по код-слову
select * from instagram_codeword_stats where codeword = 'smile';

-- Лиды, привязанные к код-слову
select l.id, l.name, l.phone, l.paid, l.amount, e.occurred_at
  from instagram_organic_events e
  join leads l on l.id = e.lead_id
  where e.event_type = 'lead' and e.codeword = 'smile'
  order by e.occurred_at desc;
```

## Ограничения и кейсы

- **Нет события `link_click`** — значит бот отдаёт «голый» `target_url`, а не короткую `ig-organic-redirect`. Перепроверь шаблон ответа.
- **DM есть, лидов нет** — проблема в лендинге: либо не передаётся `cw`, либо `target_url` в код-слове не содержит вашего лендинга. Воспроизведи редирект ручками: открой короткую ссылку в инкогнито.
- **Лиды есть, продаж/выручки нет** — менеджеры не ставят `paid=true` / `amount` в CRM. Это решается на стороне CRM-карточки (`PaymentAmountDialog`), не аналитики.
- **Дубли DM** — текущая реализация не дедуплицирует на стороне БД, но `unique_users` в view считает по `username`, так что аналитика не врёт. Если нужна дедупликация на стороне n8n — добавь там `unique(message_id)`.
- **Атрибуция «между Reel»** — если зритель написал одно и то же код-слово под двумя Reels, атрибуция пойдёт на код-слово (т.е. суммарно). Если нужна разводка по Reel — заведи разные код-слова на каждый Reel (`smile1`, `smile2`).

## Безопасность

- `ig-organic-redirect` — публичный, но никаких секретов не раскрывает: знание `short_id` даёт только редирект на тот же `target_url`, который ты сам опубликовал.
- `instagram-organic-intake` — требует `x-intake-token` (проектный токен), без него `401`.
- `lead-intake` — путь `/t/<token>` или `token` в теле, либо `project_id` + `inbound_token`. Без них лид всё равно создастся, но без привязки к проекту.
- RLS на `instagram_codewords` / `instagram_organic_events` — `user_can_access_project` (раньше было только `admin`).

## Что можно усилить позже

- Виджет «топ Reels недели» в дашборде проекта.
- Авто-генерация код-слова при публикации Reel из вашего планировщика.
- Webhook-приёмник комментариев под Reel (помимо DM) — если IG API его отдаёт.
- ROI-метрика: при наличии расходов на продакшен Reel — `revenue / production_cost`.
- Алерт «код-слово закончилось» (когда `last_event_at` старше 14 дней).
