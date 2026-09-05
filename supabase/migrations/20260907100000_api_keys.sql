-- Персональные API-ключи проекта для внешних клиентов (MCP-сервер, агенты,
-- скрипты). Раньше единственный машинный вход был общий cron_secret — он
-- открывает все проекты и все ops-функции, отдавать его наружу нельзя.
--
-- Сам ключ хранится только хэшем (sha256): показывается один раз при создании.
-- key_prefix — первые символы для узнавания в списке.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  scopes       text[] NOT NULL DEFAULT ARRAY['read', 'publish', 'manage'],
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  CONSTRAINT api_keys_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT api_keys_scopes_check CHECK (scopes <@ ARRAY['read', 'publish', 'manage'])
);

COMMENT ON TABLE public.api_keys IS
  'API-ключи проекта: авторизация внешних вызовов edge-функции api (Bearer mv_live_…). Хранится только хэш.';
COMMENT ON COLUMN public.api_keys.scopes IS
  'read — чтение аккаунтов, групп, настроек и статусов; publish — загрузка медиа и постановка публикаций; manage — правка аккаунтов, групп и настроек проекта (publish и manage включают read).';

CREATE INDEX IF NOT EXISTS api_keys_project_idx ON public.api_keys(project_id, created_at DESC);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Интерфейс читает список через edge-функцию, но политика на чтение нужна
-- для RLS-проверок доступа к проекту. Запись — только сервисной ролью:
-- хэширование и выдача ключа происходят на сервере (publish-accounts).
DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
