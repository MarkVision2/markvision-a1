# Environment: переменные и секреты контура публикаций

## Edge-функции (Supabase → Edge Functions → Secrets)

| Переменная | Кому | Назначение |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | все | системные, только на сервере |
| `PUBLISH_TOKEN_KEY` | publish-accounts, publish-oauth, worker, monitor, metrics, publish-webhooks | ключ AES-GCM для токенов площадок и секретов вебхуков (любая длинная строка; смена = токены не читаются → reconnect, секреты вебхуков — ротация) |
| `TELEGRAM_BOT_TOKEN` | runner, monitor | уведомления в чат проекта (`telegram_links`) |
| `META_APP_ID`, `META_APP_SECRET` | publish-oauth | вход в Instagram через Facebook (Facebook Login; redirect URI `…/publish-oauth/callback/instagram`) |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | publish-oauth | вход логином самого Instagram (Meta App → Instagram → API setup with Instagram login; redirect URI `…/publish-oauth/callback/instagram-login`) — **другая пара, не META_APP_\*** |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | publish-oauth, runner | приложение Threads |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | publish-oauth, runner, tiktok-connect | TikTok for Developers (Login Kit + Content Posting) |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | publish-oauth, runner | YouTube Data API v3 |
| `YOUTUBE_PRIVACY_STATUS` | publisher youtube | `public` (по умолчанию) / `unlisted` / `private` |
| `PUBLISH_MOCK_CONNECTOR` | worker | `1` — включить Mock-коннектор для аккаунтов `mock:*` (**только тестовый проект**) |
| `APIFY_TOKEN`, `OPENAI_API_KEY` / `LOVABLE_API_KEY` | radar, content-pipeline | сборщик и LLM |
| `PHONEGRID_OPEN_API_ID`, `PHONEGRID_OPEN_API_KEY` | account-devices | облачные телефоны PhoneGrid для заведения и прогрева аккаунтов («Сетка аккаунтов → Устройства»); API ID — числовой, ключ из клиента PhoneGrid (API & MCP → Open API). Без них раздел отвечает «PhoneGrid не подключён» |
| `PHONEGRID_<ПЛОЩАДКА>_WARMUP_VERSION` + `PHONEGRID_<ПЛОЩАДКА>_WARMUP_APP_VERSION_ID` | account-devices | необязательно: версия приложения под шаблон прогрева и её id в каталоге PhoneGrid (`INSTAGRAM`, `TIKTOK`). Задаются парой; переопределяют зашитые в `_lib/phonegrid.ts`, без деплоя. Для TikTok версия пока не выяснена — без этой пары прогрев TikTok выключен |

Ключ автоматизации — не переменная: `automation_settings.cron_secret` в БД (заголовок `x-automation-key`
для pg_cron и n8n). Внешним клиентам — только `api_keys` (`PUBLIC-API.md`).

## Фронт (Vite)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY` (+ `VITE_CLIENT_*`) — `DEPLOY.md`.
Никаких секретов площадок во фронте нет; токены не покидают edge-функции.

## MCP (`mcp/markvision`)

`MARKVISION_API_KEY` (`mv_live_…`), `MARKVISION_API_URL` (`https://<проект>.supabase.co/functions/v1/api/v1`).

Удалённый вариант (`node dist/http.js`): `MARKVISION_API_URL` обязателен, ключа в окружении нет — он
приходит в `Authorization: Bearer` каждого запроса; `MARKVISION_MCP_PORT` (8787), `MARKVISION_MCP_HOST`
(`127.0.0.1`; `0.0.0.0` только за TLS-прокси), `MARKVISION_MCP_PATH` (`/mcp`). Health — `GET /healthz`.

## Окружения

Один прод-проект Supabase (`szfgdruhlebfvcmlvxdk`). Для staging — второй проект с теми же миграциями
(`supabase db push`) и `PUBLISH_MOCK_CONNECTOR=1`; переключение фронта — `VITE_*`. Feature flags как
таблица — Phase 2 (`ARCHITECTURE.md`).

## Правила

- Секреты — только в Supabase Secrets / GitHub Secrets; не в коде, не в `.env` репозитория, не в логах.
- Трасса (`publish_job_events`) чистит ключи `token|secret|authorization|password|cookie`;
  `publish_logs.raw_response` хранит сырые ответы площадок — токены в них не попадают по построению запросов.
- Ротация `PUBLISH_TOKEN_KEY` = переподключение всех аккаунтов (формат `v1:` допускает `v2:` с новым ключом).

## Проверка типов edge-функций

Supabase собирает функции esbuild'ом без проверки типов, поэтому в репозитории есть
`npm run typecheck:functions` — обычный `tsc` по `supabase/functions/_types/tsconfig.check.json`
(Deno-глобалы — `deno-shim.d.ts` рядом, импорты `esm.sh/@supabase/supabase-js` сопоставлены с
установленным пакетом). Входит в `npm run ci`. Новую функцию контура публикаций — добавить в `files`.
