# ✅ Чек-лист подключения Google Ads — что нужно сделать со своей стороны

Список для передачи в Cowork. В коде/БД/на фронте всё уже готово и задеплоено
(см. `docs/google-ads-integration-TZ.md`). Ниже — только внешние шаги, которые
нельзя сделать из кода. Идите по порядку; в конце — как проверить.

Константы проекта:
- Supabase project: `szfgdruhlebfvcmlvxdk`
- **Redirect URI (важно, понадобится в шаге A):**
  `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-oauth-callback`

---

## A. Google Cloud — OAuth-приложение (авторизация «Войти через Google»)
- [ ] A1. Открыть [console.cloud.google.com](https://console.cloud.google.com/), выбрать/создать проект.
- [ ] A2. **APIs & Services → Library** → включить **Google Ads API**.
- [ ] A3. **OAuth consent screen**:
  - [ ] Тип **External**.
  - [ ] Scopes: `.../auth/adwords`, `.../auth/userinfo.email`, `openid`.
  - [ ] Пока не пройдена верификация — в **Test users** добавить рабочие Google-аккаунты (иначе «app isn't verified»).
  - [ ] Для продакшена — отправить на верификацию (scope `adwords` — sensitive, проверка Google может занять недели).
- [ ] A4. **Credentials → Create credentials → OAuth client ID**:
  - [ ] Type: **Web application**.
  - [ ] **Authorized redirect URIs** → добавить точно: `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-oauth-callback`
  - [ ] **Authorized JavaScript origins** → домен приложения (напр. `https://app.markvision.ai`) + превью-домены Vercel.
  - [ ] Сохранить **Client ID** и **Client secret** → в шаг C.

## B. Google Ads — доступ к API и конверсии
- [ ] B1. В **менеджерском (MCC) аккаунте** Google Ads → **Tools → API Center** → получить **Developer token**.
  - [ ] Для продакшена подать заявку на **Basic access** (аппрув Google). Для теста хватит тестового токена + тестового аккаунта.
- [ ] B2. Записать **`login-customer-id`** = ID менеджерского аккаунта (10 цифр без дефисов), если аккаунты под MCC.
- [ ] B3. Создать **конверсионные действия** (для оптимизации на продажи):
  - [ ] «CRM — Продажа» → тип **Import**, категория **Purchase**, учёт **каждой** конверсии.
  - [ ] (опц.) «CRM — Заявка» → тип Import, категория Lead.
  - [ ] Скопировать их **resource name** `customers/{cid}/conversionActions/{id}` → в шаг E2.
  - [ ] Включить **Enhanced conversions for leads** (если нужны офлайн-конверсии по gclid).

## C. Секреты Supabase (Edge Functions → Secrets)
Задать значения (Client ID/Secret из A4, developer token из B1):
- [ ] `GOOGLE_OAUTH_CLIENT_ID`
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET`
- [ ] `GOOGLE_ADS_OAUTH_CLIENT_ID` = то же, что `GOOGLE_OAUTH_CLIENT_ID`
- [ ] `GOOGLE_ADS_OAUTH_CLIENT_SECRET` = то же, что `GOOGLE_OAUTH_CLIENT_SECRET`
- [ ] `GOOGLE_ADS_DEVELOPER_TOKEN`
- [ ] `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (MCC id, если есть)

## D. Cron (ежедневные задачи)
Настроить POST-вызовы с заголовком `x-cron-secret: <значение CAPI_WORKER_KEY>`:
- [ ] D1. `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-ads-daily-sync` — расходы/клики/конверсии в сквозную аналитику (ежедневно).
- [ ] D2. `.../functions/v1/google-ads-structure-sync` — структура кампаний (ежедневно).
- [ ] D3. `.../functions/v1/google-ads-offline-conversions` — отгрузка продаж CRM → Google (ежедневно; после того как задан шаг E2).

## E. Подключение и конфигурация в приложении
- [ ] E1. **Приложение → Настройки → вкладка «Реклама» → «Войти через Google»** → выбрать проект → выбрать рекламный аккаунт. Появится карточка подключённого Google-кабинета.
- [ ] E2. Прописать конверсионные действия проекту — **прямо в приложении**: Настройки → «Реклама» → блок «Конверсионные действия» → вставить resource name действия «Продажа» (и опц. «Заявка») → «Сохранить».
  - Альтернатива через SQL:
    ```sql
    update public.google_ads_connections
       set conversion_action_sale = 'customers/1234567890/conversionActions/111',
           conversion_action_lead  = 'customers/1234567890/conversionActions/222'  -- опц.
     where project_id = '<project-uuid>';
    ```

## F. Сайт / Google Tag / GA4 (атрибуция заявок к Google)
Делает Cowork на сайте клиента:
- [ ] F1. В Google Ads включить **auto-tagging** (добавляет `gclid` в URL перехода) — обычно включён.
- [ ] F2. **Google Tag / GTM** на сайте: установить базовый тег, **Conversion Linker** (сохраняет gclid в cookie).
- [ ] F3. На формах: считывать `gclid` (из URL или cookie от Conversion Linker) и **передавать в заявку** — в вызов `lead-intake` в поле `gclid` (плюс опц. `google_campaign_id` из ValueTrack `{campaignid}`).
- [ ] F4. (опц.) **GA4**: создать/подключить property, связать GA4 ↔ Google Ads (импорт конверсий), поставить тег GA4 через GTM.
- [ ] F5. Подключить **фактический сайт клиента** (домен + доступ), проставить UTM-шаблон на кабинете при необходимости.

## G. Проверка (после A–F)
- [ ] G1. Настройки → «Реклама»: карточка Google-кабинета отображается (email + аккаунт).
- [ ] G2. Дёрнуть `google-ads-daily-sync` за прошлый период → в **Сквозной аналитике** появилась строка канала **Google Ads** с расходом.
- [ ] G3. Тестовая заявка в `lead-intake` с `gclid` → в CRM лид с источником **Google Ads**.
- [ ] G4. После оплаты такого лида и запуска `google-ads-offline-conversions` → в Google Ads в конверсионном действии «CRM — Продажа» появляются офлайн-конверсии.

---

## Что уже сделано в коде/БД/на фронте (проверять не нужно)
- Авторизация «Войти через Google» (per-project OAuth), хранение refresh-токена (RLS deny-all).
- Синк расходов и структуры кампаний, приём `gclid` в заявках, отгрузка офлайн-конверсий.
- Сквозная аналитика и дашборд **уже** показывают Google отдельным каналом (по `cabinet_daily_insights.provider='google'`) — как только появятся кабинет и данные синка.
- Настройки: вкладка переименована в «Реклама», карточка подключения Google рядом с Facebook.

## Уже готово дополнительно (в этой итерации)
- UI конверсионных действий в Настройках (шаг E2) — без SQL.
- Отчёт «Кампании Google Ads» на странице «Сквозная аналитика» (расход/клики/конверсии/CPL/выручка/ROAS).
- Синк на уровне групп объявлений и объявлений (`google_ad_groups`, `google_creatives`, `google_creative_daily`) — данные пишутся `google-ads-structure-sync`.

## Опционально на будущее (не блокирует запуск)
- Отдельный фронтовый отчёт на уровне объявлений Google (данные уже есть в `google_creative_daily`).
- Единая вкладка «Реклама», объединяющая все источники в одном месте.
