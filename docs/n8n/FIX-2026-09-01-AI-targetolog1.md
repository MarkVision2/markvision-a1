# Разбор `AI-targetolog1` — запуски рекламы, 01.09.2026

Воркфлоу: `AI-targetolog1` — https://n8n.zapoinov.com/workflow/LncxAleDlMPOb3hP (130 нод, active).
Повод: execution [215865](https://n8n.zapoinov.com/workflow/LncxAleDlMPOb3hP/executions/215865) — запуск упал.

Разобрано три независимые проблемы. Первые две исправлены, третья — данные клиента.

---

## 1. Запуск уходил в чужой рекламный кабинет ✅ исправлено

Запуск пришёл из Telegram-группы **«Адал Есеп Бух»** (`chat.id = -5527754100`), а
`Supabase — Get Client Config` вернул кабинет **«ВМ КЛИНИКА»** (`act_775220918446309`) —
клинику в Астане вместо бухгалтерской компании в Алматы.

Причина: на этой группе в `client_configs` висели **две строки**:

| | GULNARA ← кабинет Адала | ВМ КЛИНИКА ← лишняя |
|---|---|---|
| ad_account_id | `act_4407302662855718` | `act_775220918446309` |
| page_name | Бухгалтерский консалтинг | VM Клиника |
| город | Алматы | Астана |
| cabinet_id | `02f3e39a-8b7c-46ee-bb44-eb4dffe01bc9` | `9b028e7b-bf44-49da-8b23-ffbb581976b5` |

А запрос ноды выбирает из них произвольно:

```js
url: `${SUPABASE_URL}/rest/v1/client_configs?telegram_group_id=eq.${chatId}&select=*&limit=1`
```

`limit=1` **без `order`** — PostgREST возвращает произвольную строку.

**Исправлено:** у строки ВМ КЛИНИКА снят `telegram_group_id`
(`update client_configs set telegram_group_id = null where cabinet_id = '9b028e7b-…'`).
Проверено: на группе осталась ровно одна строка — GULNARA.

> Строка «GULNARA» — это и есть кабинет Адал Есеп (подтверждает `page_name`
> «Бухгалтерский консалтинг»). Название осталось от прежнего клиента; переименование
> сломает склейку кампаний по имени, поэтому не трогали.

### Ошибка Meta была следствием, а не причиной

`Create Ad` упал с 400 от `POST /v22.0/act_775220918446309/ads`:
`code 100, error_subcode 1359188` — «Не указан способ оплаты».

> **Карту к `act_775220918446309` привязывать НЕЛЬЗЯ.** Отсутствие оплаты сработало
> предохранителем: будь карта — реклама Адала открутилась бы за счёт клиники, молча.

Три падения на одном ошибочно выбранном кабинете: 215802, 215803, 215865.
Мусор к удалению в `act_775220918446309`: кампания `120253071117500349`
с тремя пустыми adset'ами и три креатива (`932561042624251`, `1157388813358540`,
`982034844878964`).

---

## 2. Патч A — `Create Ad` убивал запуск молча ✅ применено

`Extract AdSet ID1` **уже умеет** отчитываться об ошибке Facebook:

```js
if (inputData.error) {
  return { json: { report: `⛔️ ОСТАНОВКА ЗАПУСКА! ... Code ${inputData.error.code} ...`,
                   adID: "ERROR" } };
}
```

Но код был мёртвый: у `Create Ad` не было `neverError`, нода кидала исключение и
execution умирал **до** отчёта. Поэтому никто не увидел ни ошибки, ни того, что
запуск ушёл не в тот кабинет.

Соседняя `Upload Video Webhook FB` сделана правильно — у неё `neverError: true`.

**Применено** (`options.response.response.neverError = true`). Теперь тело ошибки Meta
проходит через `Save Ad Creative` (там `return [$input.first()]`) в `Extract AdSet ID1`
→ `Source Check` → Telegram.

Побочный эффект: `retryOnFail` (3 × 5 с) стал неактивен — исключения больше нет.
Для `is_transient: false` (биллинг, политика, права) ретраи были бесполезны.

---

## 3. Патч B — `Auto-Pause`: `PROJECT_ID is not defined` ✅ применено

Execution [215820](https://n8n.zapoinov.com/workflow/LncxAleDlMPOb3hP/executions/215820)
(ночной):

```
ReferenceError: PROJECT_ID is not defined [line 617]
```

`PROJECT_ID` использовался **5 раз, но нигде не объявлен** (`CLIENT_CONFIG_ID` — 1 раз).
`Auto-Pause` крутится по 11 кабинетам; 10 выжили на коротком замыкании
`fatigueWarnings.length > 0 && PROJECT_ID`, а ТОО «OMIS INC.» (`act_160496776998817`)
с выгоранием креатива — упал и **не получил ночной отчёт**.

Хуже: те же строки в ветке `_crm_paid > 0` завёрнуты в `try/catch`, где ошибка глохла
молча → **CAPI-событие `Purchase` не уходило в Facebook никогда**.

**Где лежит `project_id` — важно:** в `client_configs` **нет** колонок `id` и `project_id`.
Есть `cabinet_id`, ссылающийся на `ad_cabinets.id`; `project_id` — в `ad_cabinets`.
Первая версия патча ходила в `client_configs`, получала 400 и молча оставляла `null`.

**Применён блок** из `docs/n8n/fix-auto-pause.js` — запрос в `ad_cabinets` по `external_id`,
вставлен сразу после `const authParam = ...`. Проверено на всех кабинетах: резолвятся
6 из 9 уникальных аккаунтов, включая `act_160496776998817`. У АВТОДОМ, Тойота и
ДИЗАЙН МЕНЮ строк в `ad_cabinets` нет — там переменные останутся `null`, нода не упадёт.

> Тот же баг живёт в `Set Client Config`: `project_id: supabaseRow.project_id` —
> колонки нет, значит всегда `undefined`. Не чинили.

---

## 4. Кампания собиралась на трафик вместо конверсий — данные клиента

Execution 216051: кабинет уже правильный, но
`objective = OUTCOME_TRAFFIC`, `optimization_goal = LINK_CLICKS`.

Подпись к видео была «Сайт» → агент вернул `goal = "WEBSITE"`, `websiteUrl = "none"`.
Но сайта не было нигде: `client_configs.website_url` пуст, в `project_websites`
для этого кабинета 0 строк.

```js
524| const isWebsite = destination === 'website' && !!(URL...)   // URL нет → false
1040| if (!isWebsite) return clientConfig.waba_phone_number_id ? "OUTCOME_ENGAGEMENT"
                                                              : "OUTCOME_TRAFFIC";
```

Пиксель у кабинета есть (`5204715589754667`, событие `Lead`), но без URL бесполезен —
строки, дающие `OUTCOME_LEADS`, стоят **после** проверки `isWebsite`.

**Решено данными:** заполнен `website_url = https://adal-esep-check.vercel.app/`.
Execution 216055 подтверждает:

```
objective          = OUTCOME_LEADS
optimization_goal  = OFFSITE_CONVERSIONS
destination_type   = WEBSITE
promoted_object    = {"pixel_id": "5204715589754667", "custom_event_type": "LEAD"}
attribution_spec   = клик 7 дней / просмотр 1 день
```

### Структурная находка: нативный Click-to-WhatsApp недостижим

Колонки **`waba_phone_number_id` в `client_configs` не существует**.
`Supabase — Get Client Config` пишет `waba_phone_number_id: row.waba_phone_number_id || null`
→ всегда `null`. От неё зависят обе WhatsApp-ветки:

- строка 1040 → `OUTCOME_ENGAGEMENT` недостижим;
- строка 1005 → `destination_type: "WHATSAPP"` недостижим.

Значит **любой запуск на WhatsApp у любого кабинета скатывается в `OUTCOME_TRAFFIC`** —
реклама ведёт на `wa.me` как на обычный внешний сайт, Meta оптимизирует под клики,
а не под переписки. Чтобы включить: добавить колонку и привязать WhatsApp к странице.

---

## 5. Что осталось

| | Задача | Кто может |
|---|---|---|
| ☐ | Уникальный индекс на `client_configs.telegram_group_id` (DDL через REST не проходит) | SQL Editor |
| ☐ | Вернуть `availableInMCP = true` в настройках воркфлоу (сбросился при записи через публичный API) | n8n UI |
| ☐ | Удалить мусор в `act_775220918446309` (кампания `120253071117500349` + 3 adset'а) | Ads Manager |
| ☐ | Выключить трафиковую кампанию `52611500275751` в кабинете Адала | Ads Manager |
| ☐ | Патч C — не выбирать кабинет наугад при дубле группы | код |
| ☐ | Патч D — не собирать молча трафиковую кампанию при `goal=WEBSITE` без `website_url` | код |
| ☐ | Отозвать использованный ключ n8n API | n8n Settings |

### Патч C — запретить молчаливый выбор кабинета

`Supabase — Get Client Config`: убрать `limit=1`; если строк больше одной — остановиться
и написать в группу «эта группа привязана к нескольким кабинетам, уточните», вместо
запуска рекламы неизвестно чьими деньгами.

### Патч D — не выдавать трафик за успех

Сейчас при `goal = WEBSITE` без URL воркфлоу собирает трафиковую кампанию и рапортует
«✅ Рекламная кампания успешно запущена». Должен сказать, чего не хватает
(`website_url` / `lead_form_id`), и не запускать.

---

## Как применялись патчи A и B

Публичный API n8n (`PUT /api/v1/workflows/{id}`) требует поле `settings`, но принимает
в нём только `executionOrder` и ещё несколько документированных ключей. Отправка
фактических настроек воркфлоу возвращает
`request/body/settings must NOT have additional properties`, а отправка без `settings` —
`must have required property 'settings'`.

Обход: `settings: {"executionOrder": "v1"}`. Три из четырёх недокументированных ключей
(`binaryMode`, `timeSavedMode`, `callerPolicy`) при этом уцелели, **`availableInMCP`
сбросился в `false`** — вернуть в UI.

Бэкап воркфлоу до правок: `docs/n8n/AI-targetolog1.backup.json` (секреты вырезаны).
Скрипт патча: `docs/n8n/patch.py`. Вставляемый блок: `docs/n8n/fix-auto-pause.js`.

> В коде нод захардкожены Supabase **service_role** JWT (`Set Accounts`, `Auto-Pause`,
> `Save Ad Creative`, `Parse Webhook`, `Supabase — Get Client Config`), токен
> Telegram-бота и `x-creative-key` в `Save Ad Creative`. Их место — n8n Credentials.
