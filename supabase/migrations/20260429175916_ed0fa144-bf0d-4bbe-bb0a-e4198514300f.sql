-- Настройки телефонии в singleton-таблице
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS telephony_provider text NOT NULL DEFAULT 'tel',
  ADD COLUMN IF NOT EXISTS sipuni_user text,
  ADD COLUMN IF NOT EXISTS sipuni_token text,
  ADD COLUMN IF NOT EXISTS sipuni_operator text,
  ADD CONSTRAINT telephony_provider_chk CHECK (telephony_provider IN ('tel','sip','sipuni'));

-- Безопасные колонки видны всем authenticated, секретный токен — нет.
GRANT SELECT (telephony_provider, sipuni_user, sipuni_operator) ON public.automation_settings TO authenticated;
GRANT UPDATE (telephony_provider, sipuni_user, sipuni_operator) ON public.automation_settings TO authenticated;

-- sipuni_token — только service_role и admin (через явный grant админам нет smysla, читать будет edge-func; админ видит/обновляет через ту же edge-func или напрямую как owner)
-- Колонка не выдана authenticated — попытки SELECT её вернут NULL/ошибку column-level

-- Внутренний номер у менеджеров
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sip_extension text;