Понял проблему. Сейчас фронт ждёт ответ от n8n до конца выполнения, поэтому кнопка долго остаётся “Отправляем…”. Плюс n8n получает нужные токены/кабинет внутри `body.payload`, но в дальнейшем workflow, судя по примеру, работает уже с распарсенным item, где поля называются `clientConfig.fbtoken` и `clientConfig.adaccountid`, а мы отправляем `fb_token` и `ad_account_id`. Из-за этого нода “Upload Photo to FB” видит пустые `ACCESS_TOKEN / AD_ACCOUNT`. Также выбранная в интерфейсе цель `site-leads` не превращается в готовые Meta-поля для сайта, поэтому workflow строит WhatsApp-кампанию.

План исправления:

1. Сделать отправку быстрой для пользователя
- В `launch-campaign` добавить короткий режим ожидания ответа от n8n: ждать только быстрый ACK, а не весь долгий запуск.
- На фронте после успешного принятия запроса сразу закрывать окно и показывать понятный статус: “Реклама успешно отправлена на проверку”.
- Кнопка не будет висеть бесконечно в “Отправляем…”. Если webhook принял задачу — пользователь сразу получает результат.

2. Добавить нормальную сводку после отправки
- После отправки показать toast/сообщение с деталями:
  - кабинет: название и `adAccountId`
  - цель: “Лиды с сайта” / WhatsApp / Лид-форма
  - пиксель и событие для цели “Лиды с сайта”
  - бюджет и валюта
  - страница/Instagram, если есть
- Текст будет не “отправлено в n8n”, а пользовательский: “Реклама успешно отправлена на проверку”.

3. Исправить payload под то, что реально ждёт n8n
- В edge-функции `launch-campaign` продублировать критичные поля во всех форматах, которые сейчас ищет workflow:
  - `item.ACCESS_TOKEN`
  - `item.accesstoken`
  - `item.clientConfig.fb_token`
  - `item.clientConfig.fbtoken`
  - `item.clientConfig.access_token`
  - `item.AD_ACCOUNT`
  - `item.adAccount`
  - `item.clientConfig.ad_account_id`
  - `item.clientConfig.adaccountid`
- Заполнить `creativeBody.access_token`, `campaignBody.access_token`, `adSetBody.access_token`, `adBody.access_token`, если эти объекты уже сформированы или будут сформированы прокси.
- Нормализовать рекламный кабинет в формат `act_...`.

4. Жёстко исправить цель “Лиды с сайта” перед отправкой в n8n
- Если `goal === "site-leads"`, edge-функция будет добавлять/переопределять технические поля для сайта:
  - `isWebsiteGoal: true`
  - `plan.goal: "SITE_LEADS"`
  - `campaignBody.objective: "OUTCOME_SALES"` или совместимый website-конверсионный objective для текущей n8n-схемы
  - `adSetBody.optimization_goal: "OFFSITE_CONVERSIONS"`
  - `adSetBody.destination_type: "WEBSITE"`
  - `adSetBody.promoted_object.pixel_id`
  - `adSetBody.promoted_object.custom_event_type`
  - `creativeBody.object_story_spec.link_data.link` = сайт/лендинг из кабинета
  - CTA не WhatsApp, а сайт-CTA, например `LEARN_MORE`
- Убрать WhatsApp-значения из site-leads ветки, чтобы workflow не уходил в `OUTCOME_ENGAGEMENT / CONVERSATIONS / WHATSAPP`.

5. Добавить в payload явный `launchSummary` и `tracking`
- В payload добавить структурированный блок:
  - `launchSummary.goalLabel`
  - `launchSummary.cabinetName`
  - `launchSummary.adAccountId`
  - `launchSummary.pixelId`
  - `launchSummary.pixelEvent`
  - `launchSummary.websiteUrl`
- Это поможет и n8n, и UI отображать “что именно отправили”.

6. Заложить получение реального статуса от n8n
- Добавить `requestId`/`launchId` при каждом запуске и передавать его в n8n.
- Создать/обновить запись в базе со статусом запуска: `queued/submitted/running/success/error`.
- Добавить backend endpoint для callback от n8n, например `campaign-status-callback`, куда n8n сможет присылать:
  - `launchId`
  - `status`
  - `step`
  - `message`
  - `campaignId/adSetId/adId`, если созданы
  - `error`, если ошибка
- На фронте можно будет показывать “Принято”, “Загружаем креатив”, “Создаём кампанию”, “Ошибка Meta: ...”, а не гадать.

7. Улучшить обработку ошибок
- Если n8n вернул ошибку быстро — показать её пользователю нормально, не просто `Webhook 502`.
- Если ошибка пришла позже через callback — сохранить её и показать в статусе кампании/уведомлении.

Технически затрону:
- `src/components/ads/CreateCampaignDialog.tsx`
- `supabase/functions/launch-campaign/index.ts`
- возможно `src/hooks/useCabinetsStore.ts` для сохранения `requestId/status`
- новая backend-функция для callback статусов от n8n
- миграция базы для полей статуса запуска, если текущих колонок недостаточно

Что нужно будет настроить в n8n после кода:
- В начале workflow распарсить `body.payload` в JSON, если ещё не распаршено.
- После принятия задачи быстро вернуть HTTP 200, а долгие шаги выполнять дальше.
- На ключевых шагах дергать callback URL с `launchId` и статусом.
- В ноде “Upload Photo to FB” можно оставить текущий код: после дублирования `fbtoken/adaccountid/adAccount/accesstoken` он перестанет падать на missing `ACCESS_TOKEN or AD_ACCOUNT`.