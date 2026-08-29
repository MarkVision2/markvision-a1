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
