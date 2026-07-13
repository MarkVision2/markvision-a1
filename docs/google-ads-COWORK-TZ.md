# ТЗ для Cowork: запустить Google Ads (авторизация + данные + конверсии)

**Цель:** чтобы в приложении заработала кнопка «Войти через Google», расходы и
конверсии Google Ads попадали в сквозную аналитику по каждому проекту, а
реальные продажи из CRM уходили обратно в Google для оптимизации.

**Со стороны разработки всё готово** (БД, edge-функции, UI). Нужны только
внешние настройки ниже. Идите по порядку; в конце — как принять работу.

## Константы (понадобятся в шагах)
- Supabase project ref: `szfgdruhlebfvcmlvxdk`
- Base URL функций: `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/`
- **Redirect URI (точно, символ в символ):**
  `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-oauth-callback`
- Домен приложения (JS origin): указать боевой домен (напр. `https://www.markvision.kz`) + превью Vercel/Lovable.

---

## Шаг 1. Google Cloud — OAuth-приложение
1. [console.cloud.google.com](https://console.cloud.google.com/) → создать/выбрать проект.
2. **APIs & Services → Library** → включить **Google Ads API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Scopes добавить: `.../auth/adwords`, `.../auth/userinfo.email`, `openid`.
   - Раздел **Test users**: добавить Google-аккаунты, которыми будете подключать кабинеты (пока приложение не верифицировано — без этого Google покажет «app isn't verified»).
   - Для боевого использования отправить приложение на **verification** (scope `adwords` — sensitive; проверка Google может занять до нескольких недель).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs** → добавить: `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/google-oauth-callback`
   - **Authorized JavaScript origins** → домен приложения + превью-домены.
   - Нажать Create, **скопировать Client ID и Client Secret** → в Шаг 3.

## Шаг 2. Google Ads — developer token и конверсии
1. В **менеджерском (MCC) аккаунте** Google Ads: **Tools → API Center** → получить **Developer token**.
   - Для продакшена подать заявку на **Basic access** (аппрув Google). Для теста подойдёт тестовый токен + тестовый аккаунт.
2. Записать **login customer id** = ID менеджерского аккаунта, 10 цифр без дефисов (если кабинеты под MCC).
3. Создать **конверсионные действия** (для отгрузки продаж из CRM):
   - «CRM — Продажа»: тип **Import**, категория **Purchase**, считать **каждую** конверсию.
   - (опционально) «CRM — Заявка»: тип Import, категория Lead.
   - Скопировать их **resource name** вида `customers/1234567890/conversionActions/111` → понадобится в Шаге 5.

## Шаг 3. Supabase — секреты edge-функций
Dashboard проекта `szfgdruhlebfvcmlvxdk` → **Edge Functions → Secrets** → добавить:

| Секрет | Значение |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID из Шага 1 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client Secret из Шага 1 |
| `GOOGLE_ADS_OAUTH_CLIENT_ID` | то же, что `GOOGLE_OAUTH_CLIENT_ID` |
| `GOOGLE_ADS_OAUTH_CLIENT_SECRET` | то же, что `GOOGLE_OAUTH_CLIENT_SECRET` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | developer token из Шага 2 |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | ID MCC без дефисов (если есть) |

> После сохранения секретов кнопка «Войти через Google» в приложении сразу заработает (перезаливать функции не нужно).

## Шаг 4. Cron — ежедневные задачи
Настроить 3 ежедневных вызова (n8n / Supabase Scheduled / любой планировщик).
Метод **POST**, заголовок **`x-cron-secret`** = значение секрета `CAPI_WORKER_KEY` из Supabase. Тело можно пустое (возьмёт «вчера» по Asia/Almaty) или `{"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}` для бэкфилла.

| Задача | Endpoint | Зачем |
|---|---|---|
| Расходы | `…/functions/v1/google-ads-daily-sync` | spend/клики/конверсии в сквозную аналитику |
| Структура | `…/functions/v1/google-ads-structure-sync` | кампании/группы/объявления |
| Офлайн-конверсии | `…/functions/v1/google-ads-offline-conversions` | продажи CRM → Google по gclid |

## Шаг 5. В приложении (после Шагов 1–3)
1. **Настройки → вкладка «Google Ads» → «Войти через Google»** → выбрать проект → выбрать рекламный аккаунт. Должна появиться карточка подключённого кабинета.
2. В той же карточке в блоке **«Конверсионные действия»** вставить resource name из Шага 2 («Продажа», опц. «Заявка») → **Сохранить**.

## Шаг 6. Сайт клиента / Google Tag / GA4 (атрибуция заявок)
1. В Google Ads включить **auto-tagging** (добавляет `gclid` в URL перехода) — обычно включён.
2. На сайте установить **Google Tag / GTM** + **Conversion Linker** (сохраняет `gclid` в cookie).
3. В формах: считывать `gclid` (из URL или cookie) и **передавать в заявку** — в запрос на приём лида:
   - `POST https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/lead-intake`
   - тело: `{ "token": "<интейк-токен проекта из Настройки → Сайт>", "phone": "...", "name": "...", "gclid": "..." }`
   - (опц. можно добавить `google_campaign_id` из ValueTrack `{campaignid}`).
4. (опционально) **GA4**: создать property, связать GA4 ↔ Google Ads (импорт конверсий), поставить тег GA4 через GTM.
5. Подключить фактический **сайт клиента** (домен + доступ), при необходимости проставить UTM-шаблон.

---

## Приёмка (как проверить, что всё работает)
1. Настройки → «Google Ads»: отображается подключённый аккаунт (email + кабинет).
2. После первого прогона `google-ads-daily-sync`: в **Сквозной аналитике** появляется канал **Google Ads** с расходом; ниже — таблица «Кампании Google Ads».
3. Тестовая заявка в `lead-intake` с `gclid` → в CRM лид с источником **Google Ads**.
4. После оплаты такого лида и прогона `google-ads-offline-conversions` → в Google Ads в действии «CRM — Продажа» появляются офлайн-конверсии.

## Важные ограничения
- gclid для офлайн-конверсий должен быть **не старше 63 дней** от клика.
- Для офлайн-конверсий по заявкам может требоваться **Enhanced conversions for leads / consent** в Google Ads.
- Пока OAuth-приложение не верифицировано Google — подключать можно только аккаунтами из списка **Test users** (Шаг 1.3).
