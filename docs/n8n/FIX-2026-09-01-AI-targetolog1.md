# Разбор падений `AI-targetolog1` и патчи (01.09.2026)

Воркфлоу: `AI-targetolog1` — https://n8n.zapoinov.com/workflow/LncxAleDlMPOb3hP (130 нод, active).
Повод: execution [215865](https://n8n.zapoinov.com/workflow/LncxAleDlMPOb3hP/executions/215865) — запуск рекламы упал.

---

## 1. Почему упал 215865 — биллинг Meta, не код

Упала нода **`Create Ad`**, HTTP 400 от `POST /v22.0/act_775220918446309/ads`:

```json
{"error":{"message":"Invalid parameter","type":"OAuthException",
 "code":100,
 "error_subcode":1359188,
 "error_data":"{\"blame_field_specs\":[[\"account_id\"]]}",
 "error_user_title":"Не указан способ оплаты",
 "error_user_msg":"Как изменить способ оплаты: Добавьте действующий способ оплаты
                   с помощью инструмента «Биллинг и платежи»."}}
```

У кабинета `act_775220918446309` (ВМ КЛИНИКА) нет действующего способа оплаты.
Все три сегодняшних падения запуска — один кабинет и одна ошибка:

| Execution | Время | Кампания | Adset | Ad |
|---|---|---|---|---|
| 215802 | 13:00 | `120253071117500349` (создана, POST) | `120253071117950349` | ❌ 100/1359188 |
| 215803 | 13:00 | та же (переиспользована, GET) | `120253071120990349` | ❌ 100/1359188 |
| 215865 | 16:01 | та же | `120253074513040349` | ❌ 100/1359188 |

До `Create Ad` всё отработало: Gemini разобрал видео, AI Agent (50 c) и `Parse JSON1`
собрали тела, видео залилось в FB, креативы созданы.

**Действие вне кода:** Ads Manager → Биллинг и платежи для `act_775220918446309`
→ добавить действующий способ оплаты. Затем убрать мусор: кампания
`120253071117500349` с тремя пустыми adset'ами (бюджет есть, объявлений нет) и три
осиротевших креатива (`932561042624251`, `1157388813358540`, `982034844878964`).

---

## 2. Патч A — `Create Ad` не должен убивать запуск

Нода **`Extract AdSet ID1` уже умеет** отчитываться об ошибке Facebook:

```js
if (inputData.error) {
  return { json: { report: `⛔️ ОСТАНОВКА ЗАПУСКА! ... Code ${inputData.error.code} ...
                            ${inputData.error.error_user_msg || inputData.error.message}`,
                   adID: "ERROR" } };
}
```

Но код был мёртвый: у `Create Ad` в `options` не было `neverError`, поэтому нода кидала
исключение и весь execution умирал **до** отчёта. Итог — ни сообщения в Telegram, ни
колбэка статуса; на сайте запуск висит бесконечно.

Соседние ноды сделаны правильно: у `Upload Video Webhook FB` стоит
`options.response.response.neverError: true`.

**Правка** (нода `Create Ad` → Settings/Options → Response → **Never Error** = on),
то есть в JSON ноды:

```json
"options": { "response": { "response": { "neverError": true } } }
```

После этого тело ошибки Meta проходит через `Save Ad Creative`
(там `return [$input.first()]` — айтем передаётся как есть) в `Extract AdSet ID1`,
дальше `Source Check` → Telegram. Пользователь получает «⛔️ ОСТАНОВКА ЗАПУСКА»
с текстом Meta вместо тишины.

Побочный эффект: `retryOnFail` (3 попытки × 5 с) на этой ноде становится неактивным —
исключения больше нет. Для `is_transient: false` ошибок (биллинг, политика, права)
ретраи всё равно были бесполезны, а молчаливая смерть запуска — хуже.

---

## 3. Патч B — `Auto-Pause`: `PROJECT_ID is not defined`

Execution [215820](https://n8n.zapoinov.com/workflow/LncxAleDlMPOb3hP/executions/215820)
(ночной, по расписанию):

```
ReferenceError: PROJECT_ID is not defined [line 617]
```

`Auto-Pause` крутится по 11 кабинетам. 10 прошли, 11-й — **ТОО «OMIS INC.»**
(`act_160496776998817`) — упал.

Причина: `PROJECT_ID` используется в ноде **5 раз, но нигде не объявлен**
(то же с `CLIENT_CONFIG_ID` — 1 раз). Апстрим `Set Accounts` → … → `Translate`
отдаёт только `accountId, accountName, pageId, fbToken, campaigns, mode, greeting` —
project_id туда не кладётся.

Строка 617:

```js
if (fatigueWarnings.length > 0 && PROJECT_ID) {
```

JS вычисляет левый операнд первым, поэтому у кабинетов без выгорания креатива срабатывало
короткое замыкание и нода жила. У OMIS выгорание было — и нода упала.

Последствия:
- кабинет **не получил ночной отчёт в Telegram** (`Format Report` и `Telegram` — 10 раз из 11);
- строки 231/238/240 в ветке `_crm_paid > 0` завёрнуты в `try/catch`, там тот же
  `PROJECT_ID` падает **молча** → **CAPI-событие `Purchase` не уходит в Facebook никогда**.
  Meta не получает сигнал о платящих клиентах и не оптимизируется под них.

**Правка:** вставить блок из `docs/n8n/fix-auto-pause.js` **сразу после** строки

```js
const authParam = `apikey=${SUPABASE_KEY}`;
```

Блок тянет `id` и `project_id` из `client_configs` по `ad_account_id` (пробует значение
как есть, с префиксом `act_` и без него), всё в `try/catch` — если кабинет не нашёлся
или Supabase недоступен, обе переменные остаются `null`, зависимые ветки просто
пропускаются, нода не падает.

Что `client_configs` содержит `project_id` и `id` — подтверждается самим воркфлоу:
`Supabase — Get Client Config` делает `select=*` из `client_configs`, `Set Client Config`
кладёт `project_id: supabaseRow.project_id`, а `Save Ad Creative` читает
`cfg.project_id` / `cfg.id`.

Синтаксис патченной ноды проверен: `node --check` на коде, обёрнутом в `async function`.

---

## 4. Как применить

1. `Create Ad` → Options → Response → **Never Error** = on.
2. `Auto-Pause` → вставить блок из `docs/n8n/fix-auto-pause.js` после строки `const authParam = ...`.
3. Save.

---

## 5. Проверка после применения

- **Патч B:** дождаться ночного `Schedule Trigger` либо дёрнуть `Manual Optimize Webhook`
  с `only_account: "act_160496776998817"` — этот кабинет с выгоранием креатива и был
  тем самым 11-м. Ожидание: `Auto-Pause` зелёный 11 раз из 11, в `scoring_insights`
  появляется запись `recommendation_type = creative_fatigue`, в Telegram приходит
  11-й отчёт.
- **Патч A:** запустить рекламу на кабинет без способа оплаты (или до того, как он
  добавлен) — ожидание: execution **зелёный**, в Telegram «⛔️ ОСТАНОВКА ЗАПУСКА»
  с текстом «Не указан способ оплаты».

---

## 6. Замечено попутно (не чинил)

- В коде нод захардкожены Supabase **service_role** JWT (`Set Accounts`, `Auto-Pause`,
  `Save Ad Creative`, `Parse Webhook`, `Supabase — Get Client Config` и др.), а также
  токен Telegram-бота и ключ `x-creative-key` в `Save Ad Creative`. Их место —
  n8n Credentials / переменные окружения, а не тело ноды.
- `Create Campaign` и `Create AdSet` тоже кидают исключение на ошибку Meta, но
  `neverError` им ставить **нельзя**: тогда мусорные ID поедут дальше по цепочке.
  Им нужна отдельная ветка обработки ошибок, если руки дойдут.
- Запуск с сайта уже переведён на нативный контур (`3cce0d1`, «Запуск рекламы с сайта
  напрямую в Meta, без n8n»), n8n остался аварийным. Раз execution всё же появился —
  сайт до сих пор ходит по старой дороге, стоит проверить переключатель
  в `automation_settings`.
