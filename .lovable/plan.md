Проблема не в таблице Lovable Cloud: я проверил запись `KOST MARKETING` — `ad_account_id = act_394987113464047`, токен в Cloud есть (`token_status: SET`, длина 199). Ошибка повторяется потому, что активный n8n workflow всё ещё приходит в `Upload Photo to FB` со старой логикой и пустыми полями.

Что конкретно сейчас не так в активном n8n:

```text
Webhook Запуск
  → Parse Webhook
  → IF Is IG Boost?
  → AI Agent Таргетолог
  → Code in JavaScript2
  → Parse JSON1
  → IF Media Type
  → Upload Photo to FB
```

В `Upload Photo to FB` сейчас код берёт только:

```js
let ACCESS_TOKEN = item.creativeBody?.access_token;
let AD_ACCOUNT = item.adAccount;
```

И если хотя бы одно из них пустое — падает на строке 40. Fallback тоже слабый: он запускается только если `AD_ACCOUNT` уже есть. Если `adAccount` потерялся до этой ноды, fallback вообще не вызывается.

Дополнительный риск: вебхук из сайта отправляет `FormData`, где основной JSON лежит в поле `payload`. Текущий `Parse Webhook` читает `input.body || input`, но не гарантированно парсит `body.payload`. Из-за этого часть полей может теряться в production webhook-запуске, даже если на фронте payload правильный.

План исправления:

1. Исправить `Parse Webhook` в n8n
   - Нормально разбирать вход из production webhook:
     - если пришёл `body.payload` строкой — делать `JSON.parse(body.payload)`;
     - если пришёл обычный JSON — работать как сейчас;
     - если пришёл старый формат — оставить совместимость.
   - Брать `ad_account_id` из всех возможных мест:
     - `payload.ad_account_id`
     - `payload.clientConfig.ad_account_id`
     - `payload.cabinet.adAccountId`
   - Брать `cabinet_id` из:
     - `payload.cabinet.id`
     - `payload.cabinet_id`
   - Запрашивать конфиг из Lovable Cloud сначала по `cabinet_id`, потом по `ad_account_id`.
   - В выход `Parse Webhook` обязательно класть:
     - `clientConfig.fb_token`
     - `clientConfig.ad_account_id`
     - `adAccount`
     - `cabinet_id`

2. Исправить `Parse JSON1`
   - Не полагаться только на `$('Parse Webhook').first()` и `$('Set Client Config').first()`.
   - Перед возвратом результата явно добавлять в output:
     - `clientConfig`
     - `adAccount`
     - `access_token`/или `creativeBody.access_token`
     - `cabinet_id`
   - Если токена нет, но есть `cabinet_id` или `ad_account_id`, сделать прямой fallback-запрос к `cabinet-config` до формирования `creativeBody`.

3. Исправить `Upload Photo to FB`
   - Сделать его устойчивым и независимым от предыдущих потерь полей.
   - Искать токен и кабинет в таком порядке:
     - `item.creativeBody.access_token`
     - `item.clientConfig.fb_token`
     - `$('Parse Webhook').first().json.clientConfig.fb_token`
     - `$('Set Client Config').first().json.clientConfig.fb_token`
     - fallback в Lovable Cloud по `cabinet_id`
     - fallback в Lovable Cloud по `ad_account_id`
   - Искать ad account в таком порядке:
     - `item.adAccount`
     - `item.clientConfig.ad_account_id`
     - `$('Parse Webhook').first().json.clientConfig.ad_account_id`
     - `payload.cabinet.adAccountId`
   - Не удалять `act_` без необходимости. Если нет `act_` — добавить, если есть — оставить.
   - После нахождения токена принудительно записывать его обратно в `item.creativeBody.access_token`, чтобы следующие Meta-ноды тоже работали.

4. Проверить Lovable Cloud функцию `cabinet-config`
   - Убедиться, что lookup работает по:
     - `cabinet_id=01e0b8b1-48f3-4849-94d7-76d375ca221b`
     - `ad_account_id=act_394987113464047`
     - `ad_account_id=394987113464047`
   - В ответе должен быть `config.fb_token` и `config.ad_account_id`.

5. Обновить и опубликовать n8n workflow
   - Сохранить изменения в workflow `AI-targetolog1`.
   - Опубликовать активную версию, потому что сейчас active workflow обновлён в `14:23:38`, а ошибка идёт из старого кода `Upload Photo to FB`.

6. Протестировать именно webhook-запуск
   - Отправить тестовый production webhook с тем же форматом, что сайт:

```text
FormData:
  payload = JSON.stringify({...})
  creative_feed = file
```

   - Проверить в execution data:
     - после `Parse Webhook`: `clientConfig.fb_token = SET`, `adAccount = act_...`
     - после `Parse JSON1`: `creativeBody.access_token = SET`, `adAccount = act_...`
     - в `Upload Photo to FB`: ошибка `missing ACCESS_TOKEN or AD_ACCOUNT` больше не возникает.

Технически таблицы в Lovable Cloud уже содержат нужные данные. Главная правка нужна в n8n path, чтобы production webhook не терял JSON из `FormData.payload` и чтобы `Upload Photo to FB` мог сам восстановить токен/ad account по `cabinet_id` или `ad_account_id`.