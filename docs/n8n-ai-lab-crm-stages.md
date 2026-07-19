# AI Marketing Lab — n8n CRM stage automation

Отдельный workflow для запуска MarkVision AI. **Не смешивать** со стоматологическим `AI-targetolog1`.

## Endpoint

```
POST https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/crm-stage-update
Header: x-automation-key: <automation_settings.cron_secret>
Content-Type: application/json
```

## Body

```json
{
  "project_id": "cceb9a86-687b-4417-9b4e-d106bd8cc79c",
  "phone": "77001234567",
  "event": "whatsapp_messaged",
  "idempotency_key": "wa-msg-<messageId>",
  "confidence": 0.9,
  "tags": [],
  "temperature": null,
  "metadata": {}
}
```

Можно передать `lead_id` вместо `phone`.

## Events → этапы

| event | Этап |
|---|---|
| `whatsapp_messaged` | Написал в WhatsApp |
| `warming_started` | Прогрев |
| `attendance_confirmed` | Подтвердил участие |
| `webinar_attended` / `webinar_late` | Посетил вебинар |
| `webinar_no_show` | Отказ / потерян + webinar_status=no_show |
| `interest_detected` | Проявил интерес (+ temperature hot если указано) |
| `call_scheduled` / `call_completed` | Созвон |
| `offer_sent` | Предложение отправлено |
| `deposit_received` | Бронь (metadata.amount, по умолчанию 10000) |
| `payment_received` | Полная оплата |
| `student_created` | Студент |
| `rejected` | Отказ |

Правила сервера: только вперёд по воронке, идемпотентность по `project_id + idempotency_key`, аудит в `crm_automation_events`.

## Рекомендуемый flow в n8n

1. **Webhook** входящего WhatsApp (Green API / Meta) → нормализовать phone + text + messageId.
2. **HTTP** `whatsapp_messaged` с `idempotency_key=wa-msg-<id>`.
3. **IF** текст матчит `^(да|буду|подтверждаю|буду на эфире)` (case-insensitive) → `attendance_confirmed`.
4. **IF** текст содержит `цена|тариф|программ|разбор|хочу купить|сколько стоит` → `interest_detected` + `temperature: "hot"` + tag оффера.
5. Неоднозначные сообщения — **не** двигать этап; опционально тег `needs_manager`.

Прогрев-серию **не** запускать автоматически, пока тексты не утверждены. Этап `warming` можно ставить вручную кнопкой в CRM.

## Импорт

Создайте новый workflow «AI Marketing Lab — CRM stages» в https://n8n.zapoinov.com  
и скопируйте HTTP-узел из `docs/n8n-ai-lab-crm-stage-http-node.json`.
