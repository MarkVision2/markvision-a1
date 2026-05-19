## Контекст (что уже есть)

Проверил репо — половина инфраструктуры уже на месте:

- ✅ Edge functions: `meta-validate-cabinet`, `greenapi-webhook`, `meta-creative-upsert`, `capi-outbox-worker`, `meta-daily-sync`, `meta-structure-sync`, `lead-intake`
- ✅ Миграция `20260519100000_capi_outbox_and_attribution.sql` → таблицы `crm_stage_map`, `capi_outbox`, триггеры стадий
- ✅ Таблицы `ad_cabinets` (с токенами), `projects`, `meta_creatives`, `finance_plans`, `pipelines`, `pipeline_stages`
- ✅ Страница `SettingsConnection.tsx` (933 строки) — но только под WhatsApp/GreenAPI бинд
- ✅ Хук `useCabinetsStore.ts`
- ✅ Доки `docs/SETUP-CHECKLIST.md`, `docs/attribution-pipeline.md`

**Чего нет:**
- Нет единого 8-шагового визарда «Добавить проект»
- Нет edge function `greenapi-setup` (автонастройка webhook через GreenAPI /setSettings)
- Нет таблицы `ad_sync_runs` (для Health Check «когда был последний sync»)
- Нет панели Health Check (6 индикаторов)
- Нет тест-прогона (создать лида → прокатить по стадиям → проверить CAPI)
- `CreativeFunnel` не расширен до полной воронки с ROMI

## Подход — режем на 3 фазы, чтобы ничего не сломать

### Фаза 1 — Визард + сохранение (этот PR)

Один новый файл `src/pages/NewProjectWizard.tsx` + route `/projects/new`. 8 шагов в одном `<Card>` со stepper:

1. **Идентификация** → `projects` (name, domain, city, currency, timezone). Создаёт row сразу, чтобы `project_id` был доступен на следующих шагах
2. **Meta Ads API** → `ad_cabinets` (ad_account_id auto-normalize в `act_XXX`, access_token, pixel_id, pixel_event, capi_test_event_code). Кнопка «Проверить токен» → вызов `meta-validate-cabinet`, показ имени аккаунта/валюты
3. **Facebook Page + Instagram** → `ad_cabinets.page_id`, `page_name`, `instagram_id`. Кнопка «Подтянуть данные страницы» через `meta-page-assets`
4. **GreenAPI** → `whatsapp_config` (id_instance, api_token). Кнопка «Проверить подключение» (getStateInstance через `greenapi-proxy`). Кнопка «Настроить webhook автоматически» → новая edge function `greenapi-setup` (вызывает `/setSettings` с нашим webhook URL и включает incoming/outgoing/state webhooks)
5. **Лендинг и трекинг** → `ad_cabinets.landing_url`, `telegram_group_id`. Авто-генерация UTM template (с copy-кнопкой) + intake URL `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/lead-intake/t/<projects.intake_token>`
6. **CRM Pipeline mapping** → список стадий проекта + selector CAPI-события (None/Schedule/Diagnostic/Purchase). Сохраняет в `crm_stage_map` с `project_id`
7. **Финансовый план** (опционально) → `finance_plans` строка на текущий месяц
8. **Тест-прогон** → кнопка «Запустить тест»: создаёт `leads` row с `is_personal=true`, прокатывает через стадии (Schedule → Diagnostic → Purchase через `deals`), ждёт 30 сек, проверяет `capi_outbox.status='sent'`, удаляет тестовый лид. 4 чек-листа с зелёными/красными галочками

Маскировка токенов после сохранения (`••••••••XYZ`).

### Фаза 2 — Бэкенд-автоматизация (следующий PR)

- Триггер на `INSERT INTO ad_cabinets`:
  - `ensure_project_pipeline` (уже есть)
  - Авто-вызов `meta-structure-sync` для нового кабинета (через `pg_net`)
  - Создание `finance_plans` row на текущий месяц
- Новая edge function `greenapi-setup` (Фаза 1 уже её зовёт, реализация во Фазе 2 если кнопка отдельная)
- Таблица `ad_sync_runs (cabinet_id, kind, ok, error, created_at)` для трекинга последнего sync

### Фаза 3 — Health Check + CreativeFunnel ROMI

- Компонент `<CabinetHealthCheck cabinetId>` на странице кабинета: 6 индикаторов (Meta API, Pixel, WhatsApp, CAPI worker, Creative sync, CRM events) через batch RPC `cabinet_health_check(uuid)`
- `CreativeFunnel`: добавить колонки Diagnostics/Sales/Revenue/ROMI (`crmRevenue / spend * 100`), fallback на pixel revenue
- (Опц.) Админская страница `/admin/pipeline-status` с pending/sent/failed CAPI

## Что меняется в Фазе 1 (этот PR)

### Новые файлы
- `src/pages/NewProjectWizard.tsx` — мастер с 8 шагами (~500 строк, разбит на компоненты по шагам)
- `src/components/wizard/StepIndicator.tsx`, `WizardStep*.tsx` (8 компонентов, по файлу на шаг)
- `src/hooks/useWizardState.ts` — общий стейт визарда (через `useReducer`)
- `supabase/functions/greenapi-setup/index.ts` — POST `{instanceId, apiToken, webhookUrl}` → вызов GreenAPI `/setSettings`

### Миграции
- `crm_stage_map` уже есть → ничего не добавляем
- Уточнение: убедиться что `whatsapp_config.webhook_url` поле есть; если нет — добавить
- Никаких миграций для Health Check на этом этапе

### Изменения
- `src/App.tsx` (или роутер) — добавить route `/projects/new`
- Кнопка «Добавить проект» в `ProjectSwitcher` / на дашборде → ведёт на `/projects/new`

### Что НЕ трогаем
- Dashboard / Metrics / Analytics — цифры согласованы (PR #45), не редизайним
- n8n воркфлоу — отдельно
- Существующий `SettingsConnection.tsx` — оставляем как «расширенные настройки», визард — отдельный поток для нового проекта
- Существующие таблицы и RLS-политики

## Что нужно от вас (после Фазы 1)

- Подтвердить webhook URL `https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/greenapi-webhook` — но **этот project ref не совпадает** с текущим (`mekwfbqmsqiborjdrjxc`). Уточните пожалуйста: это другой проект (на котором будет жить webhook)? Или опечатка и нужно использовать наш `mekwfbqmsqiborjdrjxc`?

## DoD Фазы 1

- [ ] Менеджер может пройти 8 шагов в `/projects/new` и создать проект+кабинет
- [ ] Кнопка «Проверить Meta токен» работает
- [ ] Кнопка «Проверить GreenAPI» работает  
- [ ] Кнопка «Настроить GreenAPI webhook» вызывает `greenapi-setup` и возвращает OK
- [ ] CRM stage mapping сохраняется в `crm_stage_map`
- [ ] Тест-прогон создаёт лида и показывает 4 галочки
- [ ] Токены маскируются после сохранения
- [ ] Существующие страницы не сломаны
