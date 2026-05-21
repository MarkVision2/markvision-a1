## Что не так сейчас

Я посмотрел данные напрямую в БД и код вебхука. Картина такая:

- За 60 дней в CRM пришло **49 лидов**: 39 через WhatsApp без атрибуции, 8 через Meta с `meta_ad_id`, 2 с сайта. Meta показывает **45 лидов на креативы**.
- Воронка по креативам считается из view `meta_creative_crm_daily`, который смотрит **только** на `leads.meta_ad_id`. Поэтому 38 из 39 WhatsApp-лидов **не попадают ни в один креатив** → почти везде "0 лидов".
- В вебхуке `greenapi-webhook` есть код, который дёргает таблицу `wa_clicks` для fallback-атрибуции через клик на сайте. **Эта таблица не существует в БД** — поэтому fallback просто молча падает в `null`.
- Парсер CTWA в вебхуке смотрит в `extendedTextMessageData`, `contextInfo`, `referralData`, но не учитывает реальное поле WhatsApp Cloud API — `messageData.contextInfo.externalAdReply` (id поста + `sourceUrl=fb.me/...`), которое Green API прокидывает по-другому, и не учитывает `senderData`.
- Когда CTWA-referral приходит во **второе** сообщение от того же телефона, мы его теряем: лид уже создан, и `meta_ad_id` остаётся пустым, потому что мы апдейтим только если `existing.meta_ad_id` пуст **и** в текущем сообщении есть атрибуция.
- Сама страница не показывает строку "Лиды без креатива" — пользователь видит 0 у всех и думает, что аналитика сломана. Также нет колонки "Сообщения Meta", хотя для WhatsApp-целей именно она — основной показатель.

## Что сделаю

### 1. Достроить и починить атрибуцию (бэкенд)

**Миграция:**
- Создаю таблицу `wa_clicks` (click_id PK, project_id, utm_source/medium/campaign/content/term, fbclid, ctwa_clid, landing_url, matched, matched_phone, matched_at, created_at) с RLS (project-scoped) и индексом по `matched_phone`, `click_id`, `fbclid`.
- Создаю таблицу `phone_attribution` (phone, project_id, meta_ad_id, meta_adset_id, meta_campaign_id, click_id, source, captured_at) — атрибуция «прилипает» к телефону на 30 дней. Уникальный ключ (phone, project_id).
- RPC `backfill_lead_attribution(p_project_id, p_since)` — пробегается по `leads` без `meta_ad_id` и подтягивает из `wa_clicks` (по phone) и из `phone_attribution`. Возвращает счётчик заматченных.
- Триггер на `leads` AFTER UPDATE OF meta_ad_id: пишет/обновляет `phone_attribution`, чтобы будущие лиды с того же номера наследовали креатив.

**Вебхук `greenapi-webhook`:**
- Расширяю `parseCtwa`: добавляю поиск в `senderData`, `messageData.contextInfo.externalAdReply` (поля `sourceId`, `sourceUrl`, `ctwaClid`, `title`, `body`), `messageData.quotedMessage.contextInfo`, парсинг `sourceUrl=https://fb.me/<...>` чтобы вытащить ad id даже из ссылки.
- Логирую сырой `messageData` в `console.log` при первом сообщении от номера (один раз) — чтобы видеть реальную форму payload от Green API в будущих кейсах.
- Перед созданием/поиском лида: смотрю в `phone_attribution` по нормализованному номеру. Если есть запись младше 30 дней — использую её, даже если в текущем сообщении CTWA нет.
- После того как CTWA пришло — апдейчу лид, даже если у него уже есть `meta_ad_id` (бывает, что Green API сначала отдаёт «протухший» id, потом точный).

**Edge-функция `lead-intake` (сайт):**
- Если в payload есть `fbclid`/`utm_content`/`click_id`, делаю upsert в `wa_clicks` (matched=false). Когда тот же телефон позже придёт через WhatsApp — fallback в вебхуке его подхватит.

### 2. View `meta_creative_crm_daily`

- Беру атрибуцию не только из `leads.meta_ad_id`, но и из cовместного запроса с `phone_attribution` (для лидов без прямого ad_id, у которых телефон есть в attribution-таблице). Один UNION ALL, чтобы не ломать override-логику `manual_revenue`.
- В выборку добавляю поле `crm_messages` — пока равно `crm_leads` (количество созданных лидов = количество первых сообщений), но семантика чистая для будущего.

### 3. Страница «Воронка по креативам» (фронт)

Дизайн не трогаю, чиню функциональность:
- Показываю баннер привязки (он уже есть) и добавляю **синюю кнопку "Привязать существующие лиды"** — дёргает RPC `backfill_lead_attribution`, показывает toast "привязано N лидов", дёргает refetch.
- Добавляю псевдо-строку "Без креатива" в начало таблицы: `45 − attributed` лидов Meta, лиды/квал/продажи/выручка по неатрибутированным WhatsApp-лидам того же проекта/периода. Кликом открывается drawer со списком.
- Заменяю колонку «Лиды Meta» на пару значений `Лиды Meta · Сообщения` — для WhatsApp-целей именно messages показывает работу креатива.
- Сортировка по умолчанию: `crmRevenue desc, crmLeads desc, spend desc` — чтобы креативы без расхода уходили вниз, и не было визуального впечатления, что «работают только нулевые».
- Фильтр «Только активные» оставляю, но дефолт меняю на «все» — иначе скрываем 60 креативов из 69.
- В drawer `CreativeDetailDrawer` добавляю секцию «Источники лидов» (Meta CTWA / WhatsApp прямой / сайт) и таблицу последних 20 лидов с phone, stage, amount, created_at.

### 4. Документация в UI

Под таблицей расширяю подсказку: что нужно сделать пользователю, чтобы атрибуция выросла до ~100% (UTM-шаблон в Meta, CTWA-кнопка на сайте, не использовать общий QR на витрине без `?ad_id=`).

## Что НЕ меняю

- Дизайн страницы, цвета, шапку, типы карточек.
- Логику CRM, диалоги, оплату — это отдельные истории.
- Триггеры расчёта выручки (`on_deal_paid_attribution`) — они работают корректно, просто им нечего считать без `meta_ad_id`.

## Технические детали

- Миграция идемпотентна (`CREATE TABLE IF NOT EXISTS`, `DROP VIEW IF EXISTS … CREATE VIEW …`).
- RLS на новые таблицы: `SELECT/INSERT/UPDATE` через `user_can_access_project(auth.uid(), project_id)`; service role обходит RLS.
- `phone_attribution` нормализует phone через существующую `normalize_phone(text)`.
- Backfill RPC `SECURITY DEFINER`, `SET search_path = public`, проверяет `has_role(auth.uid(), 'admin'|'manager')` или `user_can_access_project` для проекта.
- Все запросы к view остаются прежние — фронт `useMetaCreatives` уже их использует.
