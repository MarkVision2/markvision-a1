-- Подключение аккаунта по ссылке: владелец сети выдаёт клиенту одну ссылку,
-- клиент открывает её в своём браузере, жмёт «Подключить Instagram / TikTok /
-- YouTube / Threads», проходит вход на площадке — и аккаунт появляется в сетке
-- проекта со всеми правами, метриками и здоровьем (docs/PUBLISHING-SYSTEM.md,
-- раздел «Подключение по ссылке»).
--
-- Что здесь:
--   1. publish_connect_links   — сами ссылки (токен, срок, лимит подключений, площадки);
--   2. publish_connect_pending — выбор страницы Instagram, когда у клиента их несколько;
--   3. publish_accounts.connected_via / connect_link_id — откуда приехал аккаунт;
--   4. publish_oauth_states     — instagram как площадка и ссылка вместо пользователя.
--
-- Токен хранится как есть (по образцу client_dashboard_tokens): таблица закрыта
-- RLS без политик, читает только service_role из edge-функции publish-oauth.

/* ─────────────────────────── 1. ссылки ─────────────────────────── */

CREATE TABLE IF NOT EXISTS public.publish_connect_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,
  -- Для кого ссылка: «Блогер Асель», «Клиент — сеть кофеен». Видно в списке и в отчёте.
  label         text NOT NULL,
  -- Какие площадки предлагать. Пустой массив = все поддерживаемые.
  platforms     text[] NOT NULL DEFAULT '{}',
  -- Куда положить подключённый аккаунт (необязательно).
  group_id      uuid REFERENCES public.publish_account_groups(id) ON DELETE SET NULL,
  persona_id    uuid REFERENCES public.personas(id) ON DELETE SET NULL,
  -- Сколько аккаунтов можно подключить по ссылке; NULL — без ограничения.
  max_uses      integer,
  used_count    integer NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  -- Что клиент видит на странице: короткая записка от менеджера.
  note          text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_connect_links_max_uses_check CHECK (max_uses IS NULL OR max_uses > 0)
);

ALTER TABLE public.publish_connect_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS publish_connect_links_project_idx
  ON public.publish_connect_links (project_id, created_at DESC);

COMMENT ON TABLE public.publish_connect_links IS
  'Ссылки-приглашения: клиент подключает свой аккаунт площадки сам, без доступа в MarkVision.';
COMMENT ON COLUMN public.publish_connect_links.platforms IS
  'Разрешённые площадки (instagram|tiktok|youtube|threads); пустой массив — все.';

/* ────────────── 2. отложенный выбор страницы Instagram ────────────── */

-- У клиента может быть несколько страниц Facebook с привязанным Instagram.
-- Гадать нельзя: список кладём сюда (page-токены шифруются тем же
-- PUBLISH_TOKEN_KEY), клиент выбирает на своей странице, publish-oauth
-- завершает подключение. Живёт час, чистится GC.
CREATE TABLE IF NOT EXISTS public.publish_connect_pending (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connect_link_id uuid NOT NULL REFERENCES public.publish_connect_links(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  platform        text NOT NULL DEFAULT 'instagram',
  -- [{ page_id, page_name, ig_user_id, ig_username, ig_name, ig_avatar_url,
  --    ig_followers, connectable, token_encrypted }]
  pages           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publish_connect_pending ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS publish_connect_pending_created_idx
  ON public.publish_connect_pending (created_at);

/* ─────────────── 3. откуда приехал аккаунт ─────────────── */

ALTER TABLE public.publish_accounts
  ADD COLUMN IF NOT EXISTS connected_via   text NOT NULL DEFAULT 'dashboard',
  ADD COLUMN IF NOT EXISTS connect_link_id uuid REFERENCES public.publish_connect_links(id) ON DELETE SET NULL;

ALTER TABLE public.publish_accounts DROP CONSTRAINT IF EXISTS publish_accounts_connected_via_check;
ALTER TABLE public.publish_accounts ADD CONSTRAINT publish_accounts_connected_via_check
  CHECK (connected_via IN ('dashboard', 'invite', 'api', 'device'));

COMMENT ON COLUMN public.publish_accounts.connected_via IS
  'dashboard — подключил менеджер из интерфейса; invite — клиент сам по ссылке; api — публичный API; device — облачный телефон.';

GRANT SELECT (connected_via, connect_link_id) ON public.publish_accounts TO authenticated;

/* ─────────────── 4. state OAuth: instagram и ссылка ─────────────── */

ALTER TABLE public.publish_oauth_states
  ADD COLUMN IF NOT EXISTS connect_link_id uuid REFERENCES public.publish_connect_links(id) ON DELETE CASCADE;

-- Приглашение проходит без вошедшего пользователя — user_id становится необязательным.
ALTER TABLE public.publish_oauth_states ALTER COLUMN user_id DROP NOT NULL;

-- Instagram теперь тоже ходит через publish-oauth (вход клиента в Facebook),
-- а не только через общий токен проекта в publish-accounts.
ALTER TABLE public.publish_oauth_states DROP CONSTRAINT IF EXISTS publish_oauth_states_platform_check;
ALTER TABLE public.publish_oauth_states ADD CONSTRAINT publish_oauth_states_platform_check
  CHECK (platform IN ('threads', 'tiktok', 'youtube', 'instagram'));

/* ─────────────── 5. уборка просроченного ─────────────── */

CREATE OR REPLACE FUNCTION public.content_pipeline_gc()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.pipeline_callback_nonces WHERE seen_at < now() - interval '1 day';
  DELETE FROM public.pipeline_telegram_updates WHERE seen_at < now() - interval '7 days';
  DELETE FROM public.pipeline_review_tokens
   WHERE used_at IS NOT NULL AND used_at < now() - interval '30 days';
  DELETE FROM public.publish_oauth_states WHERE created_at < now() - interval '1 hour';
  DELETE FROM public.publish_connect_pending WHERE created_at < now() - interval '1 hour';
$$;
