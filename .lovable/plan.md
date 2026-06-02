## Что делаем

Переиспользуем `automation_settings.meta_access_token` (уже есть у вас) — пользователь не вводит ничего нового, не светит пароли. Через него получаем доступ к Instagram Business аккаунтам, привязанным к Facebook Pages. Сохраняем **page access token** (long-lived, на 60 дней, с авто-рефрешем) отдельно по проекту — он нужен для Insights API.

## Безопасность

- Page access token хранится в `instagram_accounts.page_access_token` — таблица доступна только через edge функции (RLS: read только owner/admin проекта, **insert/update запрещены клиенту** — только service_role).
- Сами вызовы Graph API делаются исключительно из edge функций — токен никогда не уходит в браузер.
- Webhook signature не нужен (мы только pull, без push от Meta).
- Авто-ротация: если Meta вернёт OAuthException, помечаем `active=false` и показываем баннер «переподключить».

## База данных (миграция)

```text
instagram_accounts          — 1 IG-аккаунт на проект
  project_id, ig_user_id, username, name, profile_picture_url,
  page_id, page_name, page_access_token, followers_count,
  active, last_sync_at, last_error

instagram_media             — посты/Reels/Stories
  project_id, ig_user_id, media_id PK, media_type (IMAGE|VIDEO|CAROUSEL_ALBUM),
  media_product_type (FEED|REELS|STORY), caption, permalink,
  thumbnail_url, media_url, timestamp,
  like_count, comments_count, shares_count, saved, reach,
  impressions, video_views, plays, total_interactions,
  last_synced_at

instagram_account_daily     — снапшот аккаунта по дням
  project_id, ig_user_id, date,
  followers, reach, impressions, profile_views,
  website_clicks, new_followers

instagram_demographics      — демография (раз в сутки)
  project_id, ig_user_id, dimension (city|country|age|gender|age_gender),
  key, value, snapshot_at
```

Все таблицы с GRANT `authenticated SELECT` + `service_role ALL` и RLS через `user_can_access_project`.

## Edge функции

1. **`instagram-list-accounts`** (JWT auth) — `{project_id}`. Берёт meta_access_token, дёргает `/me/accounts` → для каждой страницы `/{page_id}?fields=instagram_business_account{id,username,name,profile_picture_url}`. Возвращает список IG-аккаунтов, доступных к подключению. **Ничего не сохраняет.**

2. **`instagram-connect`** (JWT auth) — `{project_id, page_id, ig_user_id}`. Получает page access token из `/me/accounts`, апсертит `instagram_accounts`. Триггерит первичный sync.

3. **`instagram-disconnect`** (JWT auth) — `{project_id}`. Чистит токен, ставит `active=false`.

4. **`instagram-sync`** (service-role или JWT). Pull-only:
   - `/{ig_user_id}?fields=followers_count,...`
   - `/{ig_user_id}/media?fields=...&limit=100` (последние 100 + дельта по timestamp)
   - Для каждого media → `/{media_id}/insights?metric=reach,impressions,likes,comments,shares,saved,plays,...` (метрики зависят от `media_product_type`)
   - `/{ig_user_id}/insights?metric=reach,impressions,profile_views,website_clicks&period=day`
   - Раз в сутки: `/{ig_user_id}/insights?metric=audience_city,audience_age,audience_gender_age&period=lifetime`
   - Авто-обработка expired token → mark inactive.

5. **Cron** (`pg_cron`): `instagram-sync` каждый час для всех `active=true` аккаунтов.

## UI

### Settings → Instagram органик (`InstagramOrganicSettings.tsx`)
Добавить сверху блок **«Аккаунт Instagram»**:
- Если не подключён: кнопка «Подключить Instagram» → диалог со списком доступных IG аккаунтов (из `instagram-list-accounts`) → выбор → connect.
- Если подключён: карточка с аватаром, username, кол-во подписчиков, статус последней синхронизации, кнопки «Синхронизировать сейчас» и «Отключить».
- Баннер ошибки если `last_error` есть.

### Контент-аналитика (`ContentAnalytics.tsx`) — добавить вкладки

Существующее содержимое → вкладка **«Код-слова»**.
Новая вкладка **«Instagram аналитика»** — компонент `InstagramAnalyticsPanel`:

```text
┌─ KPI cards (за период) ───────────────────────────────────┐
│ Публикаций | Охват | Показы | Лайки | Комментарии |       │
│ Репосты | Сохранения | Подписчиков (+дельта) |            │
│ Профиль-просмотры | Клики на сайт                         │
├─ Связка с CRM (из существующего instagram_codeword_stats) ┤
│ Код-слов сработало | DM получено | Кликов | Лидов |       │
│ Продаж | Выручка                                          │
├─ График: охват / показы / новые подписчики по дням ───────┤
├─ Топ контента (таблица + превью) ─────────────────────────┤
│ thumbnail | тип (Post/Reel/Story) | дата | охват |        │
│ лайки | комменты | сохранения | плеи | ER% | код-слов |   │
│ лидов | выручка                                           │
├─ Демография: города + возраст/пол (бар-чарты) ────────────┤
└────────────────────────────────────────────────────────────┘
```

PeriodPicker переиспользуем, фильтр по типу (All / Feed / Reels / Stories).

## Хуки

- `useInstagramAccount(projectId)` — статус + connect/disconnect/sync actions
- `useInstagramAnalytics(projectId, range)` — KPI + timeseries + top media + демография (JOIN с `instagram_codeword_stats` для связки с код-словами/CRM)

## Скоуп Meta-токена

Текущий meta-токен **должен** иметь: `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`. Если их нет — `instagram-list-accounts` вернёт пустой список с подсказкой переподключить Meta с этими правами. Покажу это в UI отдельным баннером.

## Файлы (новые)

- `supabase/migrations/<timestamp>_instagram_analytics.sql`
- `supabase/functions/instagram-list-accounts/index.ts`
- `supabase/functions/instagram-connect/index.ts`
- `supabase/functions/instagram-disconnect/index.ts`
- `supabase/functions/instagram-sync/index.ts`
- `src/hooks/useInstagramAccount.ts`
- `src/hooks/useInstagramAnalytics.ts`
- `src/components/settings/InstagramAccountConnect.tsx`
- `src/components/content/InstagramAnalyticsPanel.tsx`

## Файлы (правки)

- `src/components/settings/InstagramOrganicSettings.tsx` — добавить блок подключения сверху
- `src/pages/ContentAnalytics.tsx` — обернуть в Tabs (Код-слова / Instagram аналитика)

## Cron

После применения миграции — добавлю pg_cron job `instagram-sync-hourly` через `insert` tool (там идёт URL+anon key, поэтому через migration нельзя).

Подтверди — и начну. После аппрува сначала миграция, потом edge функции + UI одним заходом.