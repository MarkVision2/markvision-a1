# Yellow Tier — голосовые фичи (close/reschedule/status)

Эти фичи требуют добавления нод в основной workflow `Personal Assistant` (`NJqcFNk0BCk0M3aE`). Через API PUT для 95+ нод workflow это не безопасно — лучше внести руками в n8n UI.

## 1. Закрытие задач голосом

**Триггер**: «сделал презентацию», «выполнил отчёт», «готово с врачом»

### Изменения в `Classify Intent`

В system prompt добавить интент `close_task`:
```
- close_task — пометить ВЫПОЛНЕННОЙ существующую задачу (сделал, выполнил, готово с, закрыл)
```

И в строке возврата JSON добавить `"close_task"` в enum.

### Изменения в `Route by Intent`

Добавить новую ветку switch:
```
condition: $json.message.content.intent === "close_task"
output key: close_task
```

### Новые ноды

Скопируй pattern из cancel-ветки (`Get Pending Tasks → Match Task to Cancel → Resolve → Cancel Found?`), переименуй:

1. **Get Pending Tasks Done** — то же что Get Pending Tasks (можно переиспользовать существующую)
2. **Match Task to Close** (OpenAI):
   ```
   System:
   Пользователь сообщает что ЗАДАЧА ВЫПОЛНЕНА. Выбери из списка по смыслу.
   Задачи (id|starts_at|title):
   {{ JSON.stringify($json) }}
   JSON: {"task_id":"<uuid или null>","reason":"коротко"}
   ```
3. **Resolve Task to Close** (Code) — копия Resolve Task to Cancel
4. **Close Found?** (If) — копия Cancel Found?
5. **Supabase: Mark Done** (HTTP PATCH):
   - URL: `{{ $('Env + Chat').item.json.SUPABASE_URL }}/rest/v1/tasks`
   - Query: `id=eq.{{ $('Resolve Task to Close').item.json.task.id }}`
   - Body: `{"status":"done","completed_at":"{{ $now.toISO() }}"}`
6. **Reply: Task Closed** (Telegram):
   ```
   ✅ Готово: *{{ $('Resolve Task to Close').item.json.task.title }}*
   ```
7. **Reply: Close Not Found** (Telegram) — копия Reply: Cancel Not Found

Также добавь SQL колонку `completed_at TIMESTAMPTZ` в `tasks`:
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
```

## 2. Перенос задачи голосом

**Триггер**: «перенеси встречу с врачом на завтра в 16», «передвинь созвон на пятницу 10:00»

### Изменения в `Classify Intent`

Добавить интент `reschedule_task`:
```
- reschedule_task — ПЕРЕНЕСТИ существующую задачу на новое время (перенеси, передвинь, вместо X в Y)
```

### Изменения в `Route by Intent`

Новая ветка:
```
condition: $json.message.content.intent === "reschedule_task"
output key: reschedule_task
```

### Новые ноды

1. **Get Pending Tasks Resch** — переиспользуй
2. **Match Task to Reschedule** (OpenAI):
   ```
   System:
   Пользователь переносит задачу. Извлеки task_id и new_start_iso.
   Сейчас: {{ $now.setZone('Asia/Almaty').toFormat("yyyy-MM-dd HH:mm 'EEEE'") }}.
   Задачи: {{ JSON.stringify($json) }}
   JSON: {"task_id":"<uuid>","new_start_iso":"ISO с +05:00","new_duration_minutes":int или null}
   
   Парсинг времени: «завтра в 16» → завтра 16:00 Astana, «через час» → +60м.
   ```
3. **Resolve Reschedule** (Code) — копия с заменой match → reschedule
4. **Reschedule Found?** (If)
5. **GCal: Patch Event** (Google Calendar):
   - Operation: Update event
   - eventId: `{{ $json.task.google_event_id }}`
   - Start: `{{ $json.new_start_iso }}`
   - End: `{{ DateTime.fromISO($json.new_start_iso).plus({minutes: $json.new_duration_minutes || 60}).toISO() }}`
6. **Supabase: Update Task Time** (HTTP PATCH):
   - URL: `/rest/v1/tasks?id=eq.{{ $json.task.id }}`
   - Body: `{"starts_at": "{{ $json.new_start_iso }}", "duration_minutes": {{ $json.new_duration_minutes || 60 }}, "reminded_at": null}`
   
   **Важно**: сброс `reminded_at` чтобы новое время снова поймал шедулер.
7. **Reply: Rescheduled**

## 3. Статус-запросы голосом

**Триггер**: «сколько потратил сегодня», «доход за месяц», «остаток по ипотеке», «прогресс по квартире»

### Изменения в `Classify Intent`

Добавить интент `status_query`:
```
- status_query — ЗАПРОС статуса по финансам (сколько потратил/заработал, остаток по кредиту, прогресс по цели, сколько задач на сегодня)
```

### Изменения в `Route by Intent`

Новая ветка `status_query`.

### Новые ноды

1. **Parse Status Query** (OpenAI):
   ```
   System:
   Извлеки тип запроса и период.
   Сейчас: {{ $now.setZone('Asia/Almaty').toFormat('yyyy-MM-dd') }}.
   JSON: {
     "type": "expenses"|"incomes"|"debts"|"goals"|"tasks",
     "period": "today"|"yesterday"|"week"|"month"|"year"|"all",
     "filter_name": "имя цели/кредита или null"
   }
   ```

2. **Query Branch** (Switch на $json.type) — 5 веток

3. **Для expenses/incomes**: HTTP GET с агрегацией:
   ```
   /rest/v1/expenses?user_id=eq.{user}&occurred_at=gte.{start}&select=amount,category_id
   ```
   Потом Code-нода которая суммирует.

4. **Для debts**: GET `/rest/v1/debts_summary?user_id=eq.{user}` (view из 02_finance.sql)

5. **Для goals**: GET `/rest/v1/goals?user_id=eq.{user}&is_archived=eq.false` → форматирование прогресса

6. **Для tasks**: GET `/rest/v1/tasks?user_id=eq.{user}&starts_at=gte.{today}&starts_at=lt.{tomorrow}&order=starts_at.asc`

7. **Format Response** (Code) — собирает текстовый ответ:
   ```
   💸 Расходы за сегодня:
   • Кафе: 13 000 RUB
   • Транспорт: 2 500 RUB
   ─────
   Всего: 15 500 RUB
   ```

8. **Reply: Status** (Telegram)

## 4. Кран ремайндер по платежам (после миграции 04_payment_reminders.sql)

В шедулере (тот же workflow) добавить:

1. **Triggers**: 4-й cron-триггер `Daily 09:00 Astana` (cron expression: `0 0 4 * * *` если сервер UTC)

2. **kind=payment_reminder** в роутере

3. **Get Upcoming Payments** (HTTP):
   ```
   /rest/v1/debts?
     is_closed=eq.false&
     and=(next_payment_date.gte.{{ $now.toISODate() }},next_payment_date.lte.{{ $now.plus({days:3}).toISODate() }})&
     select=id,user_id,name,monthly_payment,current_balance,currency,next_payment_date
   ```

4. **Build Payment Reminder** (Code):
   ```js
   const debts = $input.all();
   const out = [];
   for (const d of debts) {
     const days = Math.ceil((new Date(d.json.next_payment_date) - new Date()) / 86400000);
     const text = `💳 *${d.json.name}* — платёж через ${days} ${days === 1 ? 'день' : 'дн.'}\n` +
                  `📅 ${d.json.next_payment_date}\n` +
                  `💰 ${d.json.monthly_payment} ${d.json.currency}\n` +
                  `Остаток: ${d.json.current_balance} ${d.json.currency}`;
     out.push({ json: { user_id: d.json.user_id, text, debt_id: d.json.id } });
   }
   return out;
   ```

5. **Lookup chat_id** → **Send Telegram** → **Mark Sent**:
   ```
   PATCH /rest/v1/debts?id=eq.{{ debt_id }}
   body: { "last_payment_reminder_sent_at": "{{ $now.toISO() }}" }
   ```

   В Get Upcoming Payments добавь фильтр `&or=(last_payment_reminder_sent_at.is.null,last_payment_reminder_sent_at.lt.{{ $now.minus({days:1}).toISO() }})` чтобы не дублировать.

## Чек-лист импорта

- [ ] Применить `sql/04_payment_reminders.sql` в Supabase SQL Editor
- [ ] Применить `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;`
- [ ] Открыть workflow `Personal Assistant` в n8n UI
- [ ] Сделать backup: Export → JSON
- [ ] Добавить интенты + ветки по этому документу
- [ ] Save & активировать
- [ ] Тест: послать боту «сделал презентацию» → проверь tasks.status=done
- [ ] Тест: послать «перенеси встречу на завтра в 15» → проверь tasks.starts_at + GCal
- [ ] Тест: послать «сколько потратил сегодня» → должен ответить суммой
- [ ] Тест: проверить cron в 09:00 — пришёл ли ремайндер о платеже
