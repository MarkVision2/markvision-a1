# План: запуск MarkVision AI

## 1. Создать главного администратора

Через Supabase Admin API (service role) создать пользователя:
- Email: `zapoinov@bk.ru`
- Пароль: `zapoinov@bk.ru`
- Email подтверждён сразу (`email_confirm: true`)
- В `profiles`: name = «Zapoinov», display_role = «Главный админ»
- В `user_roles`: роль `admin`

Триггер `handle_new_user` сам создаст базовый profile + роль `manager` — после этого мы её заменим на `admin`.

## 2. Создать проект «MarkVision AI»

Вставить запись в `projects`:
- name: `MarkVision AI`
- initials: `MV`
- is_primary: `true`
- created_by: id нового админа

И записать его в `user_active_project` для нового админа (чтобы при логине проект был активен).

## 3. Ребрендинг интерфейса в MarkVision AI

Заменить текстовые упоминания старого названия:
- `index.html` — `<title>`, `meta author`, `og:title`, `twitter:title` → **MarkVision AI**
- `src/components/factory/Header.tsx` — заголовок «kostagency.kz» → **MarkVision AI**
- `src/components/crm/ConnectWhatsAppDialog.tsx` — placeholder «Kost Agency» → «MarkVision AI»

(Места `MarkVision`, `markvision.app`, `markvision.kz` уже корректные — оставляем.)

## 4. Проверка интеграций

- **META_ACCESS_TOKEN** — секрет уже установлен ✅. После создания кабинета в БД токен подтянется в edge-функции `meta-daily-sync`, `meta-validate-cabinet`, `meta-insights`, `sync-token-to-cabinet`.
- **GREENAPI_*** — секреты установлены ✅, функция `greenapi-proxy` готова.
- **LOVABLE_API_KEY** — установлен ✅ (используется в AI-функциях).

## 5. Проверка таблиц Supabase

Полная схема уже создана и активна (28 таблиц со всеми RLS-политиками):
`ad_cabinets`, `ad_campaigns`, `agency_clients`, `agency_client_services`, `automation_runs`, `automation_settings`, `cabinet_daily_insights`, `communications`, `deals`, `events`, `finance_plans`, `lead_status_history`, `leads`, `loss_reasons`, `monthly_finance`, `pipeline_stages`, `pipelines`, `profiles`, `project_briefs`, `projects`, `quick_replies`, `report_subscriptions`, `revenue_plan`, `tasks`, `team_member_modules`, `user_active_project`, `user_roles`, `whatsapp_config`.

Дополнительные миграции не нужны — структура полная и под все фичи системы.

## Технические детали

- Создание пользователя: edge-функция с `supabase.auth.admin.createUser` (через одноразовый скрипт, т.к. UI требует уже залогиненного админа).
- Вставки в `projects` / `user_roles` / `user_active_project` / `profiles` — через `supabase--insert` с привязкой к свежесозданному `auth.uid`.
- После применения — открыть `/login`, ввести `zapoinov@bk.ru` / `zapoinov@bk.ru`, проект `MarkVision AI` будет уже активен.
