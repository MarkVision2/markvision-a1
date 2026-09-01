# Система автопубликации видео

Одно готовое видео → пачка аккаунтов площадок, через официальные API, с очередью,
статусами, журналом и уведомлениями. Рассчитано на рост 10 → 100 → 1000 аккаунтов.

Ключевое решение: **никакой автоматизации через браузер** (Multilogin, Selenium и
прочее). Multilogin остаётся только для ручной поддержки аккаунтов. Публикация —
через Content Publishing API площадок.

```
n8n                → оркестратор: заявки, AI-варианты текста, отчёты
Supabase (Postgres)→ аккаунты, видео, задания, журнал + очередь на pg_cron
Edge-функции       → публикаторы (API площадок) и сторожа
Storage            → файлы видео (Supabase buckets / R2)
```

## Чтобы заработало

Проверка готовности одной командой (ничего не публикует, только читает):

```bash
node scripts/publishing-doctor.mjs --key <automation_settings.cron_secret> --project <uuid>
```

**Уже сделано и лежит в репозитории/n8n:**

* схема, очередь и кроны — миграцией;
* публикаторы и endpoint'ы — edge-функциями, `verify_jwt` проставлен;
* воркфлоу «🚀 Система автопостинга» создан, ключ автоматизации в ноде
  «Настройки» подставлен, воркфлоу включён (до деплоя его тики — пустые);
* существующие `instagram_accounts` перенесены в `publish_accounts` миграцией.

**Что нужно сделать руками — по порядку:**

1. **Влить ветку в `main`.** Миграция и функции выкатятся сами
   (`.github/workflows/supabase-deploy.yml`). До этого весь контур отвечает
   «Requested function was not found» — это единственная причина, по которой
   сейчас ничего не работает.
2. **Добавить секрет `PUBLISH_TOKEN_KEY`** (Supabase → Edge Functions → Secrets,
   любая длинная случайная строка). Нужен, чтобы подключать *новые* аккаунты:
   перенесённый из `instagram_accounts` аккаунт публикуется и без него.
3. **Проверить ключ автоматизации.** В ноду «Настройки» подставлено значение из
   миграции `20260429175117`. Если вы меняли `automation_settings.cron_secret` —
   замените его в n8n; `publishing-doctor` покажет это как «ключ не принят».
4. **Подключить аккаунты**: `publish-accounts` → `available` → `connect`.
   Требование площадки: Instagram в режиме Business/Creator + привязанная
   Facebook-страница. Аккаунт без этого в `available` придёт с
   `connectable: false`.
5. **Пустить первое видео** — раздел «MVP-чеклист» ниже.

Чего в контуре сознательно нет: интерфейса в MarkVision, публикаторов
TikTok/YouTube/Threads и автопродления Meta-токенов. Детали — в конце документа.

## Что где

| Слой | Где живёт |
|---|---|
| Схема БД | `supabase/migrations/20260901160000_publishing_system.sql` |
| Общая библиотека | `supabase/functions/_lib/publishing.ts` |
| Переходы статусов задания | `supabase/functions/_lib/publishRunner.ts` |
| Публикаторы площадок | `supabase/functions/_lib/publishers/` |
| Приём видео и постановка заданий | `supabase/functions/publish-intake/` |
| Разбор очереди | `supabase/functions/publish-worker/` |
| HTTP-точка публикации | `supabase/functions/publish-dispatch/` |
| Аккаунты (подключение, вкл/выкл) | `supabase/functions/publish-accounts/` |
| Сторожа токенов и ошибок | `supabase/functions/publish-monitor/` |
| n8n-воркфлоу (копия) | `docs/n8n-autoposting.json` |
| Диагностика готовности | `scripts/publishing-doctor.mjs` |
| Тесты чистой логики | `src/test/publishing.test.ts` |

Существующий автопостинг контент-плана (`cf_scheduled_posts` + edge `publisher`)
не тронут: это отдельная дорога, один Instagram на проект.

## Таблицы

Имена из ТЗ получили префикс `publish_` — схема в Supabase общая на весь продукт,
`accounts` и `videos` в ней заняли бы слишком общие слова.

| ТЗ | Таблица |
|---|---|
| accounts | `publish_accounts` |
| videos | `publish_videos` |
| publish_jobs | `publish_jobs` |
| publish_logs | `publish_logs` |
| account_groups | `publish_account_groups` |

Отличия от ТЗ, все — по делу:

* **`project_id` во всех таблицах.** MarkVision мультитенантный: RLS режет строки по
  проекту, без этого аккаунты одного клиента были бы видны другому.
* **Токены зашифрованы (AES-GCM, ключ `PUBLISH_TOKEN_KEY`)**, и права `SELECT` на
  колонки с шифротекстом не выданы даже участнику проекта. Интерфейс читает вью
  `publish_accounts_safe` — те же строки без токенов.
* **`publish_jobs` уникальны по `(video_id, account_id)`.** Повторный вызов
  «поставить задания» не создаёт второй пост в тот же аккаунт.
* **`container_id` в задании.** Незавершённая загрузка на стороне площадки
  запоминается ДО публикации: повтор добивает её, а не заливает видео заново.
* **`caption_variants` у видео.** Уникальный текст на аккаунт — это раскладка
  вариантов по кругу; сами варианты пишет n8n через AI.

## Жизненный цикл задания

```
pending ──claim──► processing ──► published
   ▲                   │
   │                   ├──► retry ──(scheduled_at, backoff)──► claim снова
   │                   ├──► manual_review   (площадка не подключена)
   └──────retry────────┴──► failed          (отказ по существу или 5 попыток)
```

Кто и что решает:

| Ситуация | Задание | Аккаунт |
|---|---|---|
| Опубликовано | `published` | `last_post_at`, серия ошибок обнулена |
| Медиа ещё обрабатывается | `retry` через минуту, `container_id` сохранён | — |
| Сеть, 5xx, «сервис занят» | `retry`, пауза 1→30 мин, до 5 попыток | серия ошибок +1 |
| Токен недействителен | `retry` через час — ждёт reconnect | `token_expired`, Telegram |
| Лимит площадки | `retry` через час | `limited`, Telegram |
| Отказ по существу (формат, политика) | `failed`, Telegram | серия ошибок +1 |
| Площадка не подключена в коде | `manual_review` | — |
| 3 ошибки подряд | — | `error` + `publish_enabled=false`, Telegram |

Отбор заданий — SQL-функция `claim_publish_jobs(p_batch, p_lock_timeout)`. Она же
держит три правила, ради которых очередь и заводилась:

* `FOR UPDATE SKIP LOCKED` — два воркера не возьмут одно задание;
* истёкшая аренда возвращает задание в очередь (воркер умер — работа не потерялась);
* аккаунт не выйдет за `daily_limit` публикаций за календарные сутки, и задания
  выключенных/просроченных аккаунтов не отбираются вовсе.

## Endpoint'ы

База: `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/`.
Авторизация машинных вызовов — заголовок `x-automation-key` =
`automation_settings.cron_secret`. Из интерфейса — пользовательский JWT
(роль `admin`/`manager`, для `publish-accounts` — доступ к проекту).

### `POST publish-intake`

Приём видео и постановка заданий — воркфлоу 1 и 2 из ТЗ.

```jsonc
{
  "action": "video_ready",            // или "create_jobs" (тогда нужен video_id)
  "project_id": "uuid",
  "file_url": "https://…/video.mp4",  // площадки скачивают файл сами
  "thumbnail_url": "https://…/cover.jpg",
  "title": "…",
  "base_caption": "текст поста",
  "caption_variants": ["вариант 1", "вариант 2"],   // раскладываются по аккаунтам
  "hashtags": ["клиника", "импланты"],
  "duration_sec": 42,
  "target": {
    "group_id": "uuid",               // или account_ids, или platforms
    "account_ids": ["uuid"],
    "platforms": ["instagram"],
    "mode": "drip",                   // now | drip | daily
    "per_hour": 10,
    "start_at": "2026-09-02T09:00:00Z"
  }
}
```

Проверки на входе: `https`-ссылка, расширение `.mp4/.mov/.m4v`, content-type и вес
по HEAD (если хранилище отдаёт), длительность 3 c … 15 мин.

Ответ: `{ ok, video_id, created, skipped, accounts: [{ id, account_name, scheduled_at }] }`.
`skipped` — задания, которые уже стояли по этой паре видео+аккаунт.

### `POST publish-dispatch/<platform>`

Контракт из ТЗ (`POST /publish/instagram`). Два режима:

* `{ "job_id": "uuid" }` — выполнить задание очереди со всеми переходами статусов;
* `{ "account_id", "video_url", "caption", "hashtags" }` — разовая публикация.

Ответ: `{ success, status, external_post_id, external_post_url }`.
При `status: "processing"` вернётся `container_id` — передайте его в следующий вызов.

### `POST publish-worker`

Разбор очереди. Тело `{ "batch_size": 5 }`. Вызывается кроном ежеминутно и пинком
из `publish-intake`. Ответ — счётчики: `claimed / published / processing / retry / failed / manual_review`.

### `POST publish-monitor`

`{ "mode": "tokens" }` — проверка живости токенов (крон, раз в сутки).
`{ "mode": "errors" }` — гашение аккаунтов с серией отказов (крон, раз в 15 минут).

### `POST publish-accounts`

`available` → что можно подключить, `connect` → подключить пачкой,
`list` / `update` / `disconnect`. Подробности — «Онбординг» ниже.

## Кроны

Поставлены миграцией, все три бьют в edge-функции через `net.http_post`:

| Задание | Расписание | Что делает |
|---|---|---|
| `publish-worker-minutely` | `* * * * *` | разбор очереди, пачка по 5 |
| `publish-monitor-tokens-daily` | `0 6 * * *` | проверка токенов |
| `publish-monitor-errors-quarterly` | `*/15 * * * *` | гашение аварийных аккаунтов |

Очередь не зависит от доступности n8n: n8n оркеструет заявки и отчёты, но разбор
идёт на pg_cron.

## n8n

Один воркфлоу — **🚀 Система автопостинга** (`pafUBGlU0DlbzGIc` на
`n8n.zapoinov.com`), копия — `docs/n8n-autoposting.json`. Три входа сходятся в
общую цепочку: нода «Маршрут» определяет, откуда пришла работа, дальше ветки
расходятся и снова сходятся на отчёте.

| Вход | Что делает |
|---|---|
| `POST /webhook/publishing-video-ready` | новое видео: принять, проверить, разложить по аккаунтам |
| `POST /webhook/publishing-create-jobs` | уже принятое видео (`video_id`) разложить ещё раз |
| расписание, раз в 15 минут | разбор очереди + гашение аварийных аккаунтов, отчёт |

```
Видео готово ─┐
Задания ──────┼→ Настройки → Маршрут → Тик очереди?
Расписание ───┘                          ├─ да  → publish-worker → publish-monitor → Сводка очереди ─┐
                                         └─ нет → Заявка валидна?                                    │
                                                    ├─ да  → publish-intake → Сводка заявки → Ответ ──┤
                                                    └─ нет → Отказ ──────────────────────→ Ответ ─────┤
                                                                                Telegram настроен? ←──┘
```

Невалидная заявка получает причину отказа в ответе вебхука, а не generic-500.
Тик расписания вебхуку не отвечает и идёт сразу в отчёт; отчёт молчит, когда
сказать нечего.

**Воркфлоу включён, ключ подставлен.** В ноде «Настройки»:

* `automation_key` — уже заполнен значением `automation_settings.cron_secret` из
  миграции. В копии `docs/n8n-autoposting.json` на его месте намеренно оставлен
  `PASTE_CRON_SECRET_HERE`: секрет не размножается по файлам репозитория, но
  при повторном импорте JSON ключ придётся вписать снова;
* `tg_bot_token` и `tg_chat_id` — не заполнены; пусты — отчёт в Telegram не
  уходит (уведомления об ошибках публикации edge-функции всё равно шлют в чат
  проекта).

Расписание здесь — страховка и отчёт: основной разбор очереди идёт на pg_cron
ежеминутно и от доступности n8n не зависит.

## Онбординг Instagram

Один раз на аккаунт, дальше руками ничего:

1. Instagram переведён в **Business** или **Creator**.
2. Аккаунт привязан к **Facebook-странице**, страница добавлена в Meta Business.
3. Пользователь проходит Meta OAuth (уже есть: `facebook-oauth-start/callback/finish`).
4. `publish-accounts` с `action: "available"` → список страниц; `connectable: false`
   означает «к странице не привязан Instagram Business/Creator».
5. `action: "connect"` с `page_ids: [...]` — пачкой. Система сама возьмёт page-токен,
   вытащит `ig_user_id`, зашифрует токен и заведёт аккаунты.

Существующие `instagram_accounts` перенесены миграцией автоматически (токен
открытым текстом, как лежал; после первого reconnect перезапишется шифротекстом).

## Площадки

| Площадка | Состояние | Что нужно для запуска |
|---|---|---|
| Instagram | **работает** | Business/Creator + Facebook Page + Meta OAuth |
| TikTok | контракт готов, код — заглушка | client_key/secret приложения TikTok, верифицированный домен видео (`PULL_FROM_URL`) |
| YouTube | контракт готов, код — заглушка | OAuth-клиент Google Cloud; **audit проекта** — иначе загрузки принудительно `private` |
| Threads | контракт готов, код — заглушка | доступ Threads API, токен аккаунта |

Заглушка не жжёт попытки: задание уходит в `manual_review`, в журнал пишется, чего
не хватает. Подключение площадки = один файл в `_lib/publishers/` + строка в реестре.

## Деплой

1. **Секрет.** В Supabase → Edge Functions → Secrets добавить `PUBLISH_TOKEN_KEY`
   (любая длинная случайная строка; свернётся в ключ AES-256). Без него
   `publish-accounts connect` откажется сохранять токены.
2. **Миграция и функции** выкатываются сами при пуше в `main`
   (`.github/workflows/supabase-deploy.yml`, пути `supabase/**`). Это два
   независимых шага: функции могут выкатиться, а миграция — упасть, и контур
   будет отвечать 401 вместо 404, не имея ни одной таблицы. Именно это
   различает `publishing-doctor`: он отдельно спрашивает функции и отдельно —
   схему через PostgREST.
3. **n8n**: воркфлоу «🚀 Система автопостинга» уже включён с подставленным
   ключом — делать ничего не нужно, если `cron_secret` не менялся.
4. **Проверить**: `node scripts/publishing-doctor.mjs --key … --project …`

`verify_jwt = false` проставлен в `supabase/config.toml` для `publish-worker`,
`publish-intake`, `publish-dispatch`, `publish-monitor` — их зовут pg_cron и n8n без
пользовательского JWT, авторизация внутри по `x-automation-key`. У
`publish-accounts` проверка JWT остаётся: это точка, которая пишет токены.

## MVP-чеклист: пять аккаунтов

1. Задать `PUBLISH_TOKEN_KEY`, влить миграцию и функции.
2. Подключить 5 Instagram-аккаунтов (`publish-accounts` → `available` → `connect`).
3. Проверить, что аккаунты видны: `select * from publish_accounts_safe`, статус
   `active`, `publish_enabled = true`.
4. Отправить одно видео в `POST /webhook/publishing-video-ready` с
   `target: { platforms: ["instagram"], mode: "drip", per_hour: 10 }`.
5. Смотреть `publish_jobs` — 5 заданий, расходятся по 6 минут.
6. Через несколько минут: `status = published`, `external_post_url` заполнен.
7. Разбор проблем — `publish_logs` по `job_id`: там сырой ответ площадки.

Не начинать со 100 аккаунтов. Сначала доказать, что стабильно работают 5.

## Группы аккаунтов

«Залить во все клиники» — это группа. Управление там же, в `publish-accounts`:

```jsonc
{ "action": "group_upsert", "project_id": "uuid", "name": "Все клиники",
  "account_ids": ["uuid", "uuid"], "publish_strategy": "drip", "per_hour": 10 }
```

Дальше в заявке достаточно `target: { "group_id": "…" }`. Чужие аккаунты в
группу не попадут: принадлежность проекту проверяется при сохранении.

## Что осталось за рамками первого захода

* Интерфейс в MarkVision (список аккаунтов, кнопка «залить во все», статусы) —
  данные и вью для него готовы (`publish_accounts_safe`, `publish_jobs`).
* Публикаторы TikTok / YouTube / Threads — по таблице «Площадки».
* Автопродление Meta-токенов (сейчас монитор помечает мёртвые и зовёт на reconnect).
