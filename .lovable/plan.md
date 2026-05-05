## Что сейчас не так

- KPI-блоки показывают «+100%» как дельту даже когда сравнивать не с чем — выглядит как баг.
- Воронка и «По каналам» рядом, но «По каналам» содержит только одну строку «Реклама» (бакет `ads`) — реальные каналы (FB/Google/TikTok/Instagram) не разделяются.
- UTM сохраняются в `leads.utm` (jsonb), но `useLeadsLite` их не вытягивает и аналитика их не использует.
- Нет сравнения с прошлым периодом, нет графика динамики, нет таблицы UTM-кампаний.

## Что сделаю

### 1. Атрибуция по UTM (бэкенд + фронт)

- В `useLeadsLite` добавить поля `utm` (source/medium/campaign/content/term), `cabinetId`, `paidAt`.
- Новый файл `src/lib/channelAttribution.ts`: функция `resolveChannel(lead)` возвращает один из:
  `facebook`, `instagram`, `google`, `tiktok`, `youtube`, `vk`, `yandex`, `telegram`, `whatsapp`, `direct`, `referral`, `other`.
  Логика приоритетов: `utm.source` → `utm.medium` → `lead.source` → `lead.channel` → `referrer host`.
  Распознаются варианты: `fb|facebook|meta|ig|instagram|tt|tiktok|google|adwords|yt|youtube|yandex|direct|vk|tg|telegram|wa|whatsapp`.
- В `lead-intake/index.ts` расширить `SOURCE_ALIASES` (tiktok, youtube, vk) и автозапись `utm.source = lower(...)` если `source` пуст — это уже работает, докручу детект из `referrer`.

### 2. Связка расхода Meta ↔ канал

- Расход из `cabinet_daily_insights` (Meta) считается как канал `facebook` (+ `instagram` если кабинет помечен IG-only — пока кладём в `facebook`).
- Под Google / TikTok / Yandex расход = 0 пока пользователь не подключит соответствующий рекламный кабинет (UI оставляет место под подключение).

### 3. Редизайн страницы `/analytics`

Структура (сверху вниз):

```text
[ Header: Сквозная аналитика | период | кабинет ]

[ KPI grid 4 кол. ]
  Расход · Лиды · CPL · Продажи · Выручка · ROMI · Конверсия · Средний чек
  - дельта vs прошлый месяц (реальная), без «+100%»-затычки
  - акцент только на CPL и ROMI

[ Воронка | График Динамика по дням (расход vs лиды vs продажи) ]

[ Эффективность каналов — карточки + таблица ]
  Карточки FB · Google · TikTok · Instagram · Яндекс · Прямой · Прочие
  По каждой: Расход · Лиды · CPL · Продажи · Выручка · ROMI
  Под карточками — таблица «UTM-кампании»:
    utm_source / utm_campaign | Лиды | Продажи | Выручка | CPL (если есть расход)

[ Топ источников трафика — компактный список с прогресс-барами ]
```

Дизайн: сохранить deep-navy/emerald, убрать ярко-красный «-100%» на ROMI без расхода (показать «—»), прибрать «+100%» дельты, добавить иконки соцсетей (lucide), скруглённые карточки с тонкой границей.

### 4. Файлы

- `src/pages/Analytics.tsx` — переработка верстки, новые секции.
- `src/lib/channelAttribution.ts` — новая функция атрибуции.
- `src/hooks/useLeadsLite.ts` — добавить `utm`, `cabinetId`, `paidAt`, `referrer`.
- `src/components/analytics/ChannelCard.tsx` — карточка канала (новый).
- `src/components/analytics/UtmTable.tsx` — таблица UTM-кампаний (новый).
- `src/components/analytics/TrendChart.tsx` — график по дням на recharts (новый).
- `supabase/functions/lead-intake/index.ts` — добавить алиасы tiktok/youtube/vk и детект источника из `referrer` (host → source).

### 5. Что НЕ делаю в этой итерации

- Реальные API Google/TikTok/Yandex — только UI и место под расход. Подключение кабинетов этих сетей — отдельная задача.
- Изменения схемы БД не нужны: `utm` уже хранится в `leads.utm`.

После апрува — реализую всё одним проходом.