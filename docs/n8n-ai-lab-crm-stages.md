# AI Marketing Lab — Launch Funnel + n8n CRM stages

Отдельный workflow для запуска MarkVision AI. **Не смешивать** со стоматологическим `AI-targetolog1`.

## Воронка (Launch Funnel v2)

```
1. Новый лид
2. Личный бот активирован     ← сообщение доставлено
3. Вступил в группу
4. Подтвердил участие         ← «будешь завтра?» → да
5. Посетил вебинар            ← ?lead=<uuid> на странице эфира
6. Бронь 10 000 ₸             ← Kaspi webhook (не вручную)
7. Созвон назначен
8. Созвон проведён
9. Счёт / договор отправлен
10. Полная оплата             ← webhook
11. Студент
12. Выпускник
— Отказ / потерян             ← обязательна причина
```

В карточке лида сверху — чеклист пути + прогресс %.

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
  "event": "bot_activated",
  "idempotency_key": "wa-delivered-<messageId>",
  "confidence": 0.9,
  "tags": [],
  "temperature": null,
  "metadata": {}
}
```

Можно передать `lead_id` вместо `phone`. Для посещения вебинара предпочтительно `lead_id` из `?lead=`.

## Events → этапы

| event | Этап |
|---|---|
| `bot_activated` / `whatsapp_messaged` | Личный бот активирован |
| `joined_group` / `warming_started` | Вступил в группу |
| `attendance_confirmed` | Подтвердил участие |
| `webinar_attended` / `webinar_late` | Посетил вебинар |
| `webinar_no_show` | Отказ + webinar_status=no_show (нужен reject_reason в metadata или ручной) |
| `deposit_received` | Бронь (metadata.amount, default 10000) |
| `call_scheduled` / `call_completed` | Созвон |
| `offer_sent` | Счёт / договор отправлен |
| `payment_received` | Полная оплата |
| `student_created` | Студент |
| `graduated` | Выпускник |
| `rejected` | Отказ (обязателен `reject_reason`) |
| `interest_detected` | legacy → Созвон назначен |

Правила сервера: только вперёд по воронке, идемпотентность по `project_id + idempotency_key`, аудит в `crm_automation_events`.

## Рекомендуемый flow в n8n

1. **Webhook** WA delivery/read → `bot_activated`.
2. Кнопка «Вступить в группу» / join event → `joined_group`.
3. Ответ «да/буду» на reminder → `attendance_confirmed`.
4. Открытие `…?lead=<uuid>` на странице эфира → `webinar_attended`.
5. Kaspi webhook оплаты 10 000 → `deposit_received`.
6. Полная оплата → `payment_received`.

## Причины отказа (обязательны)

`expensive` · `no_time` · `thinking` · `no_value` · `no_authority` · `competitor` · `no_contact` · `other`

## Импорт

Создайте workflow «AI Marketing Lab — CRM stages» в https://n8n.zapoinov.com  
и скопируйте HTTP-узел из `docs/n8n-ai-lab-crm-stage-http-node.json`.
