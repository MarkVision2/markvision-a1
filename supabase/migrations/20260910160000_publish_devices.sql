-- Реестр облачных телефонов по проектам.
--
-- Ключ PhoneGrid один на всю платформу, и список телефонов в нём общий. Без реестра любой
-- проект с правом чтения видел все телефоны сети, а с правом управления мог включить чужой,
-- открыть его экран и ввести текст. Теперь принадлежность ведём сами: телефон закрепляется
-- за проектом при создании из интерфейса или при первом действии управления (включение,
-- привязка, экран, установка), после чего другие проекты его не видят.
--
-- Таблица закрыта RLS без политик: читает и пишет только service_role из edge-функции
-- account-devices. Паролей и токенов здесь нет — только id телефона у поставщика.

CREATE TABLE IF NOT EXISTS public.publish_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider    text NOT NULL DEFAULT 'phonegrid',
  phone_id    text NOT NULL,
  phone_name  text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_devices_phone_uniq UNIQUE (provider, phone_id)
);

ALTER TABLE public.publish_devices ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS publish_devices_project_idx
  ON public.publish_devices (project_id, created_at DESC);

COMMENT ON TABLE public.publish_devices IS
  'Какому проекту принадлежит облачный телефон поставщика (PhoneGrid). Один телефон — один проект.';
COMMENT ON COLUMN public.publish_devices.phone_id IS
  'Id телефона у поставщика (publish_accounts.device_phone_id ссылается на него).';

-- Телефоны, уже привязанные к аккаунтам, закрепляем за проектами этих аккаунтов.
INSERT INTO public.publish_devices (project_id, provider, phone_id, phone_name)
SELECT a.project_id, COALESCE(a.device_provider, 'phonegrid'), a.device_phone_id, a.device_phone_name
FROM public.publish_accounts a
WHERE a.device_phone_id IS NOT NULL
ON CONFLICT (provider, phone_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
