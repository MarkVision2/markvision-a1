-- Binotel: обе миграции одним файлом для ручного применения в SQL Editor.
-- Нужен только если GitHub Actions не смог выполнить db push (нет SUPABASE_DB_PASSWORD).
-- Идемпотентно: повторный запуск безопасен.

-- Binotel (украинская виртуальная АТС) как ещё один провайдер телефонии.
-- Архитектура повторяет Sipuni: секреты живут в automation_settings и читаются
-- только сервером (edge functions), фронт видит лишь *_present-флаг.

-- 1. Настройки Binotel в singleton-таблице automation_settings
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS binotel_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS binotel_key text,
  ADD COLUMN IF NOT EXISTS binotel_secret text,
  ADD COLUMN IF NOT EXISTS binotel_operator text,      -- внутренний номер по умолчанию (например 901)
  ADD COLUMN IF NOT EXISTS binotel_pbx_number text,    -- внешний номер, через который звоним
  ADD COLUMN IF NOT EXISTS binotel_crm_base_url text;  -- база для ссылки в карточку лида (apiCallSettings)

-- Индикатор «ключи заданы» без выдачи самих ключей на фронт.
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS binotel_credentials_present boolean
    GENERATED ALWAYS AS (
      binotel_key IS NOT NULL AND length(binotel_key) > 0
      AND binotel_secret IS NOT NULL AND length(binotel_secret) > 0
    ) STORED;

-- 2. telephony_provider теперь принимает 'binotel'
ALTER TABLE public.automation_settings DROP CONSTRAINT IF EXISTS telephony_provider_chk;
ALTER TABLE public.automation_settings
  ADD CONSTRAINT telephony_provider_chk
  CHECK (telephony_provider IN ('tel','sip','sipuni','binotel'));

-- 3. Гранты: безопасные колонки — authenticated, ключи — никогда.
GRANT SELECT (binotel_enabled, binotel_operator, binotel_pbx_number, binotel_crm_base_url,
              binotel_credentials_present) ON public.automation_settings TO authenticated;
GRANT UPDATE (binotel_enabled, binotel_operator, binotel_pbx_number, binotel_crm_base_url)
  ON public.automation_settings TO authenticated;

REVOKE SELECT (binotel_key, binotel_secret) ON public.automation_settings FROM authenticated;
REVOKE SELECT (binotel_key, binotel_secret) ON public.automation_settings FROM anon;
REVOKE UPDATE (binotel_key, binotel_secret) ON public.automation_settings FROM authenticated;
REVOKE UPDATE (binotel_key, binotel_secret) ON public.automation_settings FROM anon;

-- 4. Запись ключей только через RPC админом.
-- SECURITY DEFINER (в отличие от save_sipuni_token) — чтобы функция работала
-- независимо от того, есть ли у роли колоночный UPDATE-грант.
CREATE OR REPLACE FUNCTION public.save_binotel_credentials(p_key text, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_key IS NULL OR trim(p_key) = '' OR p_secret IS NULL OR trim(p_secret) = '' THEN
    RAISE EXCEPTION 'key and secret are required';
  END IF;
  UPDATE public.automation_settings
     SET binotel_key = trim(p_key),
         binotel_secret = trim(p_secret)
   WHERE id = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_settings row missing';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_binotel_credentials(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.save_binotel_credentials(text, text) TO authenticated;

-- 5. Аудит входящих webhook-ов Binotel (apiCallSettings + apiCallCompleted)
CREATE TABLE IF NOT EXISTS public.binotel_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL CHECK (request_type IN ('apiCallSettings','apiCallCompleted')),
  general_call_id text,
  raw_payload jsonb,
  phone_normalized text,
  direction text CHECK (direction IN ('in','out')),
  disposition text,
  recording_url text,
  duration_sec int,
  started_at timestamptz,
  processing_status text NOT NULL
    CHECK (processing_status IN ('lead_found','lead_not_found','parse_error')),
  lead_id_resolved uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_binotel_call_log_created_at ON public.binotel_call_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_binotel_call_log_phone ON public.binotel_call_log (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_binotel_call_log_lead ON public.binotel_call_log (lead_id_resolved);
CREATE INDEX IF NOT EXISTS idx_binotel_call_log_status ON public.binotel_call_log (processing_status);
-- Один и тот же звонок Binotel может прислать до 7 раз (ретраи apiCallCompleted).
CREATE UNIQUE INDEX IF NOT EXISTS uq_binotel_call_log_completed
  ON public.binotel_call_log (general_call_id)
  WHERE request_type = 'apiCallCompleted' AND general_call_id IS NOT NULL;

ALTER TABLE public.binotel_call_log ENABLE ROW LEVEL SECURITY;

-- Админ: полный read
DROP POLICY IF EXISTS binotel_call_log_select_admin ON public.binotel_call_log;
CREATE POLICY binotel_call_log_select_admin
  ON public.binotel_call_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Участники проекта: только записи, привязанные к лиду их проекта
DROP POLICY IF EXISTS binotel_call_log_select_via_lead ON public.binotel_call_log;
CREATE POLICY binotel_call_log_select_via_lead
  ON public.binotel_call_log
  FOR SELECT
  TO authenticated
  USING (
    lead_id_resolved IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = binotel_call_log.lead_id_resolved
        AND (l.project_id IS NULL OR public.user_can_access_project(l.project_id))
    )
  );

-- INSERT/UPDATE/DELETE — только service_role (обходит RLS), политик нет.

-- 6. Поиск лида по телефону, устойчивый к формату записи номера.
-- Binotel присылает украинские номера как 0XXXXXXXXX, а в CRM телефон может
-- лежать как +380XXXXXXXXX / +38 (0XX) XXX-XX-XX — сравниваем последние 9 цифр.
CREATE OR REPLACE FUNCTION public.find_lead_by_phone_digits(p_phone text)
RETURNS TABLE (
  id uuid, project_id uuid, assigned_to uuid, phone text, name text, source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.project_id, l.assigned_to, l.phone, l.name, l.source
    FROM public.leads l
   WHERE length(regexp_replace(p_phone, '\D', '', 'g')) >= 9
     AND right(regexp_replace(l.phone, '\D', '', 'g'), 9)
       = right(regexp_replace(p_phone, '\D', '', 'g'), 9)
   ORDER BY l.created_at DESC
   LIMIT 1;
$$;

-- Индекс под ровно то же выражение, что и в WHERE — иначе seq scan по leads
-- на каждом входящем звонке (Binotel ждёт ответ, пока телефон звонит).
CREATE INDEX IF NOT EXISTS idx_leads_phone_tail9
  ON public.leads ((right(regexp_replace(phone, '\D', '', 'g'), 9)));

REVOKE ALL ON FUNCTION public.find_lead_by_phone_digits(text) FROM public;
GRANT EXECUTE ON FUNCTION public.find_lead_by_phone_digits(text) TO service_role;


-- Binotel, вторая часть: постоянное хранение записей разговоров,
-- длительность звонка в ленте лида и автосоздание лида с неизвестного номера.

-- 1. Длительность звонка.
-- Поле callDurationSec уже читает LeadChatPanel, но заполнять его было нечем —
-- в communications не было колонки. Теперь есть.
ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS duration_sec int;

COMMENT ON COLUMN public.communications.duration_sec
  IS 'Длительность разговора в секундах (type=call)';

-- 2. Бакет для записей разговоров.
-- Ссылка Binotel на запись живёт 15 минут, поэтому в communications нельзя
-- складывать её как есть — качаем файл и храним у себя. Настройки бакета
-- повторяют crm-chat-media (там уже лежат голосовые клиентов из WhatsApp).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings', 'call-recordings', true, 104857600,
  ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/ogg','audio/webm']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "call_recordings_public_read" ON storage.objects;
CREATE POLICY "call_recordings_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'call-recordings');

-- Пишет только service_role (обходит RLS) — из edge-функции binotel-webhook.

-- 3. Автосоздание лида при звонке с неизвестного номера.
-- Классический сценарий Binotel + CRM: клиент позвонил впервые — карточка
-- появилась сама. Выключено по умолчанию: включать осознанно, иначе воронка
-- забьётся спамом и ошибочными наборами.
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS binotel_auto_create_leads boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS binotel_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.automation_settings.binotel_project_id
  IS 'В какой проект падают лиды, созданные из входящих звонков Binotel';

GRANT SELECT (binotel_auto_create_leads, binotel_project_id) ON public.automation_settings TO authenticated;
GRANT UPDATE (binotel_auto_create_leads, binotel_project_id) ON public.automation_settings TO authenticated;
