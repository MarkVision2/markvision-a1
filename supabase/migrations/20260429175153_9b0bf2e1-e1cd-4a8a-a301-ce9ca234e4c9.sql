-- Удаляем view с definer-проблемой
DROP VIEW IF EXISTS public.automation_settings_safe;

-- Сбрасываем дефолтные grants
REVOKE ALL ON public.automation_settings FROM authenticated, anon;

-- Разрешаем читать только безопасные колонки всем authenticated
GRANT SELECT (id, followup_2h_enabled, followup_2h_minutes,
              auto_msg_24h_enabled, auto_msg_24h_hours, auto_msg_24h_template_key,
              revival_7d_enabled, revival_7d_days, revival_7d_template_key,
              updated_at)
ON public.automation_settings TO authenticated;

-- Колонка cron_secret — только service_role (по умолчанию, т.к. authenticated её не видит)
-- Update — также только service/admin через RLS
GRANT UPDATE (followup_2h_enabled, followup_2h_minutes,
              auto_msg_24h_enabled, auto_msg_24h_hours, auto_msg_24h_template_key,
              revival_7d_enabled, revival_7d_days, revival_7d_template_key)
ON public.automation_settings TO authenticated;

-- Уточняем SELECT-политику (was USING(true)) — оставляем true, это допустимо для read-only
-- но линтер его игнорирует только для SELECT — оставляем как есть, т.к. это публичные настройки внутри приложения.

-- Существующие предупреждения о always-true SELECT — допустимы (read-only внутренние настройки), оставляем.