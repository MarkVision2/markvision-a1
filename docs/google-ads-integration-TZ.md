# ТЗ: интеграция Google Ads (сквозная аналитика по каналам)

Документ для Cowork / внешних настроек. Часть работы уже сделана в приложении
(см. раздел «Что уже готово»), часть требует ручных действий в Google Cloud,
Google Ads и на сайте клиента (см. «Что нужно сделать вне кода»).

Модель источников трафика в системе:
- **Meta (Facebook)** — платный трафик (`ad_cabinets.provider='facebook'`).
- **Instagram** — органика по код-словам (раздел «Контент-центр», `cf_*`).
- **Google Ads** — новый платный источник (`ad_cabinets.provider='google'`).

Задача Google Ads: подключить рекламный кабинет через авторизацию Google,
тянуть расходы/клики/конверсии и привязывать заявки к каналу, чтобы в
«Сквозной аналитике» было видно окупаемость каждого канала (сколько потрачено,
сколько заявок/диагностик/продаж, выручка, ROAS).

---

## 1. Что уже готово (в приложении)

### БД (миграции)
- `20260712130000_google_ads_oauth.sql`:
  - `google_oauth_states`, `google_oauth_pending_selections` — поток OAuth.
  - `google_ads_connections` — хранение per-project refresh-токена + `login_customer_id` + email. RLS deny-all: токен читается только под service role.
  - `leads`: добавлены `gclid`, `google_campaign_id`, `google_ad_group_id`, `google_ad_id` для атрибуции.

### Edge-функции (задеплоены)
- `google-oauth-start` — проверяет доступ к проекту, отдаёт ссылку согласия Google.
- `google-oauth-callback` — меняет `code` на refresh-токен, сохраняет подключение, перечисляет доступные customer-аккаунты и создаёт кабинет(ы) `ad_cabinets(provider='google')` (или откладывает выбор).
- `google-oauth-finish` — завершает подключение при нескольких аккаунтах.
- `google-ads-daily-sync` — тянет дневную статистику по Google Ads API и пишет в `cabinet_daily_insights(provider='google')`. Теперь берёт refresh-токен **per-project** из `google_ads_connections` (env — глобальный fallback).
- `google-ads-intake` — резервный webhook: приём заранее посчитанных дневных строк из n8n/ETL (если не хотим OAuth/API).

### Фронтенд
- `src/components/settings/GoogleAdsConnect.tsx` — кнопка «Войти через Google», диалог выбора аккаунта, список подключённых Google-кабинетов. Встроен в Настройки → вкладка рекламных подключений (рядом с Facebook).
- Атрибуция каналов (`src/lib/channelAttribution.ts`, `leadSource.ts`) уже понимает Google — заявка с `utm_source=google`/`gclid` попадёт в канал Google Ads автоматически.

### Приём заявок
- `lead-intake` принимает `gclid`, `google_campaign_id`, `google_ad_group_id`, `google_ad_id`. Если пришёл `gclid` без явного `utm_source` — источник по умолчанию `google`.
  > ⚠️ Требует redeploy `lead-intake` из репозитория (в текущей сессии не деплоился, чтобы не рисковать живым эндпоинтом приёма лидов).

---

## 2. Что нужно сделать вне кода (Cowork / вручную)

### 2.1 Google Cloud — OAuth-приложение
1. Открыть/создать проект в [Google Cloud Console](https://console.cloud.google.com/).
2. **Enable API**: включить «Google Ads API».
3. **OAuth consent screen**:
   - Тип: External.
   - Scopes: `https://www.googleapis.com/auth/adwords`, `.../auth/userinfo.email`, `openid`.
   - Пока не пройдена верификация — добавить рабочие Google-аккаунты в **Test users** (иначе выдаст «app not verified»). Для продакшена — отправить приложение на верификацию (scope `adwords` — sensitive).
4. **Credentials → Create OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**: `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-oauth-callback`
   - **Authorized JavaScript origins**: домен приложения (например `https://app.markvision.ai` и превью-домены Vercel).
   - Сохранить `client_id` и `client_secret`.

### 2.2 Google Ads — developer token
1. В **менеджерском (MCC) аккаунте** Google Ads: API Center → получить **developer token**.
2. Для продакшена нужен **Basic access** (заявка на аппрув). Для теста — тестовый токен + тестовый аккаунт.
3. Записать `login-customer-id` = id MCC (10 цифр без дефисов), если аккаунты под менеджером.

### 2.3 Секреты edge-функций (Supabase → Functions → Secrets)
| Секрет | Значение | Кто использует |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | client_id из 2.1 | google-oauth-start/callback |
| `GOOGLE_OAUTH_CLIENT_SECRET` | client_secret из 2.1 | google-oauth-callback |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` | = `GOOGLE_OAUTH_CLIENT_ID` (то же значение) | google-ads-daily-sync |
| `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | = `GOOGLE_OAUTH_CLIENT_SECRET` | google-ads-daily-sync |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | developer token из 2.2 | callback (список аккаунтов) + daily-sync |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | id MCC (без дефисов), опц. | callback + daily-sync |

> Примечание: `google-ads-daily-sync` исторически читает пару `GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET`, а OAuth-функции — `GOOGLE_OAUTH_CLIENT_ID/SECRET`. Проще всего задать обе пары одинаковыми значениями.

### 2.4 Расписание синка (cron)
Настроить ежедневный вызов `google-ads-daily-sync` (по образцу `meta-daily-sync`):
- `POST https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-ads-daily-sync`
- Заголовок `x-cron-secret: <значение CAPI_WORKER_KEY>` (или админский JWT).
- Тело можно пустое (возьмёт «вчера» по Asia/Almaty) или `{ "since":"YYYY-MM-DD", "until":"YYYY-MM-DD" }` для бэкфилла.

### 2.5 Сайт клиента / GTM (ключевое для атрибуции)
1. **Включить auto-tagging** в Google Ads (добавляет `gclid` в URL перехода) — обычно включён по умолчанию.
2. На лендинге: считывать `gclid` из URL и сохранять (cookie/скрытое поле формы), затем передавать в `lead-intake` в payload: `{ "gclid": "...", "google_campaign_id": "{campaignid}", ... }`. Значения структуры можно взять из **ValueTrack** параметров финального URL (`{campaignid}`, `{adgroupid}`, `{creative}`), либо оставить только `gclid`.
3. **Конверсии в Google Ads** (для оптимизации показов на реальные заявки/продажи):
   - Быстрый путь: gtag/GTM conversion action на отправку формы / клик по WhatsApp.
   - Точный путь (рекомендуется): **Offline Conversion Import** — наш CRM знает `gclid → продажа`, отгружаем офлайн-конверсии обратно в Google. Требует отдельной edge-функции `google-ads-offline-conversions` (не реализована; см. «Дальнейшие шаги»).
4. Подключить фактический сайт, с которым работаем (домен + доступ), проставить UTM-шаблон на кабинете (`ad_cabinets.utm_template`).

---

## 3. Как это работает (поток данных)

```
Пользователь → согласие Google (google-oauth-start → Google → google-oauth-callback)
   └─> google_ads_connections.refresh_token (per-project)
   └─> ad_cabinets (provider='google', external_id=customer_id)

Ежедневно: cron → google-ads-daily-sync
   └─> Google Ads API (расходы, показы, клики, конверсии, revenue)
   └─> cabinet_daily_insights (provider='google', per-project)

Заявка с сайта → lead-intake (gclid/utm) → leads (source=google, gclid, google_*_id)

Сквозная аналитика: cabinet_daily_insights + leads (по каналам)
   └─> расход vs заявки/диагностики/продажи/выручка/ROAS по каналу Google Ads
```

Маппинг полей Google Ads → `cabinet_daily_insights`:
| Google Ads метрика | Колонка |
|---|---|
| `metrics.cost_micros / 1e6` | `spend` |
| `metrics.impressions` | `impressions` |
| `metrics.clicks` | `clicks` |
| `metrics.conversions` | `leads` |
| `metrics.conversions_value` | `revenue` |
| (расчёт) | `cpl`, `cpm`, `cpc`, `ctr` |

---

## 4. Тестирование (после настройки секретов)
1. Настройки → вкладка рекламных подключений → «Войти через Google» → выбрать аккаунт.
   - Ожидаем: в `google_ads_connections` появилась строка, в `ad_cabinets` — кабинет `provider='google'`, в UI — карточка подключённого кабинета.
2. Дёрнуть `google-ads-daily-sync` за прошлый период → проверить строки в `cabinet_daily_insights` (provider='google') для проекта.
3. Отправить тестовую заявку в `lead-intake` с `gclid` → лид с `source=google` и заполненным `gclid` → канал Google Ads в Сквозной аналитике.

---

## 5. Дальнейшие шаги (не реализовано, на будущее)
- `google-ads-offline-conversions` — отгрузка `gclid → продажа/диагностика` обратно в Google Ads (uploadClickConversions) для оптимизации.
- Синк структуры кампаний (campaign/adgroup/ad) как у Meta (`meta-structure-sync`) — для отчёта «воронка по объявлениям Google».
- `google-list-accounts` как отдельный эндпоинт (сейчас перечисление внутри callback).
- Единая вкладка «Реклама» в Настройках, объединяющая Facebook + Google + другие источники.
