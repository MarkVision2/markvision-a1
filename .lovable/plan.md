# Сквозная аналитика по креативам

Сейчас мы знаем по креативу только то, что отдаёт Meta (показы, клики, spend, лиды на стороне Meta). Связи **креатив → лид в CRM → сделка → деньги** нет. Сделаем её сквозной.

## 1. Привязка лида к конкретному креативу

Добавим в `leads` колонки:
- `meta_ad_id text` (главный ключ креатива)
- `meta_adset_id text`
- `meta_campaign_id text`
- `click_id text` (fbclid / ctwa_clid — для дедупа и сверки)

Индексы по `meta_ad_id`, `meta_campaign_id`.

Источники, откуда эти поля будут заполняться (порядок приоритета):

1. **WhatsApp / CTWA (Click-to-WhatsApp)** — основной канал.  
   В `greenapi-webhook` приходит `referral` объект от Meta (`source_id` = ad_id, `source_type=ad`, `headline`, `body`, `ctwa_clid`). Парсим его при создании лида и сохраняем `meta_ad_id`, `meta_adset_id` (если есть), `meta_campaign_id`, `click_id`. Это даёт точную атрибуцию — никаких UTM не нужно.
2. **Сайт / лендинг** — `lead-intake` принимает `ad_id`, `adset_id`, `campaign_id`, `fbclid` явно + парсит из `utm_content` (шаблон `{{ad.id}}`) и из `fbclid`.
3. **Lead Form (нативные лидформы Meta)** — добавим в `meta-structure-sync` функционал-побратим (отдельная задача, опционально на этом шаге заглушка).

В UTM-шаблоне кабинета (`ad_cabinets.utm_template`) проставим дефолт:  
`utm_source=meta&utm_medium={{placement}}&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}`  
и подскажем это в UI настроек кабинета.

## 2. Агрегация «креатив × CRM»

Создаём view `meta_creative_crm_daily` (materialized refresh nightly + on-demand) с колонками:

```text
ad_id | date | crm_leads | crm_qualified | crm_sales | crm_revenue | crm_avg_check
```

Где:
- `crm_leads` — `count(leads)` где `meta_ad_id = ad_id` и `created_at::date = date`
- `crm_qualified` — лиды, дошедшие до квалифицирующего этапа (`pipeline_stages.is_diagnostic` или дальше)
- `crm_sales` / `crm_revenue` — из `deals` со `status='paid'`, дата = `paid_at::date`, привязка через `lead → meta_ad_id`

Дополнительно — RPC `get_creative_funnel(ad_id, since, until)` возвращает воронку по этапам пайплайна для конкретного креатива (сколько лидов в каждом этапе, конверсии между этапами, среднее время).

## 3. Расширение карточки креатива

`CreativeCard` — добавить две группы KPI с переключателем:
- **Meta**: spend, CPM, CTR, CPL(meta)
- **CRM**: лиды, продажи, выручка, **ROMI** = `(crm_revenue − spend) / spend`, CPL(crm), CPS, средний чек

Цветовая маркировка ROMI (красный <0, серый 0-100%, зелёный >100%).

`CreativeExpanded` — отдельный блок «Сквозная воронка»:

```text
Показы → Клики → CRM-лиды → Квалифицировано → Запись → Визит → Продажа
   12k      210        38           22          14       9       6
              17.6%   18.1%        57.9%      63.6%   64.3%  66.7%
```

+ список последних 10 лидов с этого креатива (имя, статус, сумма) — клик ведёт в карточку лида в CRM.

+ сводка снизу: Spend / Revenue / Profit / ROMI / CPL / CPS / Avg check.

## 4. Сортировки и фильтры в `AdsCreativesPanel`

Добавляем сортировки: `crm_leads`, `crm_sales`, `crm_revenue`, `romi`, `cps`, `avg_check`.  
Фильтр «Только с CRM-лидами» / «Только прибыльные (ROMI>0)».  
Тогглы метрик (Meta / CRM / Both) сохраняются в URL.

## 5. Дашборд: топ-креативы по ROMI

В разделе «Аналитика креативов» на дашборде Top-6 пересобираем по `crm_revenue` и подписываем ROMI вместо CPL. Ссылка → `/ads?tab=creatives&sort=romi`.

## 6. Что не делаем сейчас

- Не трогаем структуру `meta_creative_daily` (Meta-side метрики остаются как есть).
- Не делаем мульти-touch атрибуцию (только last-click / referral).
- Не подключаем Google Ads креативы — только Meta.
- Не пишем CAPI-обратную отправку продаж в Meta (это отдельная задача).

## Технические детали

**Миграции:**
- `ALTER TABLE leads ADD COLUMN meta_ad_id text, meta_adset_id text, meta_campaign_id text, click_id text` + индексы.
- View `meta_creative_crm_daily` (обычный view; если будет тяжело — превратим в materialized).
- RPC `get_creative_funnel(p_ad_id text, p_since date, p_until date) returns jsonb`.
- Бэкфилл: `UPDATE leads SET meta_ad_id = utm->>'content' WHERE utm ? 'content' AND utm->>'source' IN ('meta','facebook','instagram')`.

**Edge functions:**
- `greenapi-webhook` — парсить `messageData.extendedTextMessageData.contextInfo` / `referral` от Meta CTWA, заполнять `meta_ad_id` при создании лида.
- `lead-intake` — добавить в Zod схему `ad_id`, `adset_id`, `campaign_id`, `fbclid`; парсить `fbclid` из URL.

**Хуки:**
- `useMetaStructure` — добавить join с `meta_creative_crm_daily`, возвращать объединённую агрегацию `{ meta: {...}, crm: {...} }` по каждому креативу.
- Новый `useCreativeFunnel(adId, period)` — для блока воронки.

**Компоненты:**
- `CreativeCard.tsx` — KPI-toggle и ROMI-бейдж.
- `CreativeExpanded.tsx` — блок «Сквозная воронка» + таблица последних лидов.
- `AdsCreativesPanel.tsx` — новые сортировки/фильтры.
- `src/components/dashboard/CreativesGrid.tsx` (топ-6) — сортировка по ROMI.
- `SettingsAdCabinet` (или где редактируется кабинет) — подсказка про UTM-шаблон с `{{ad.id}}`.
