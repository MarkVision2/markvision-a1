-- Хардненинг изоляции проектов: закрываем пути, по которым данные одного
-- проекта/кабинета могли утечь другому (в дополнение к фиксу content-center).
--
-- Все изменения проверены на безопасность для текущего фронта и edge-функций:
--   * фронт читает эти объекты только под JWT пользователя (RLS применяется);
--   * edge-функции ходят под service role (RLS обходится) — их не задеваем.

-- 1) instagram_accounts_safe: view был SECURITY DEFINER и отдавал строки в обход
--    RLS базовой таблицы — авторизованный пользователь мог перечислить
--    Instagram-аккаунты ЧУЖИХ проектов (username, подписчики и т.д.).
--    Переводим на security_invoker: view начинает уважать политику
--    instagram_accounts (admin OR user_can_access_project(project_id)).
--    Токенов во view нет (только *_token_present булевы), фронт читает под JWT.
alter view public.instagram_accounts_safe set (security_invoker = true);

-- 2) client_configs: политика "client_config select anon" (SELECT USING true)
--    отдавала ВСЕ строки, включая access_token, любому держателю anon-ключа.
--    Фронт эту таблицу только пишет (upsert/delete в cabinetSync.ts), никогда
--    не читает; читатели — edge-функции под service role (crm-stage-capi) и
--    n8n через функцию cabinet-config. Убираем анонимный SELECT — утечка
--    токенов закрыта, запись кабинета (dual-write) продолжает работать через
--    оставшиеся INSERT/UPDATE политики.
drop policy if exists "client_config select anon" on public.client_configs;

-- 3) Служебные таблицы с токенами и легаси-CRM: RLS был выключен, то есть любой
--    держатель anon-ключа мог прочитать всё напрямую через PostgREST. Фронт их
--    не читает (0 ссылок в src/), доступ только у edge-функций под service role.
--    Включаем RLS без политик (deny-all для anon/authenticated), как у cf_*.
alter table public.client_dashboard_tokens      enable row level security;
alter table public.inbound_tokens_legacy_szfg    enable row level security;
alter table public.pipelines_legacy_szfg         enable row level security;
alter table public.pipeline_stages_legacy_cf     enable row level security;
alter table public.lead_status_history_legacy_cf enable row level security;
