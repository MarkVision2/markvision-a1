-- Два входа в Instagram из кабинета (docs/AUTOPOSTING-PLATFORM.md):
--   1. вход через Facebook — берём страницы человека и привязанные к ним
--      Instagram Business (page-токен, бессрочный);
--   2. вход в сам Instagram (Instagram API with Instagram Login) — аккаунту
--      достаточно быть профессиональным, страница Facebook не нужна;
--      токен живёт 60 дней и продлевается.
-- Раньше обе дороги были доступны только клиенту по ссылке-приглашению, а
-- менеджер мог подключать Instagram лишь общим Meta-токеном проекта.

/* ─────────────── 1. каким входом идёт человек ─────────────── */

ALTER TABLE public.publish_oauth_states
  ADD COLUMN IF NOT EXISTS mode text;

ALTER TABLE public.publish_oauth_states DROP CONSTRAINT IF EXISTS publish_oauth_states_mode_check;
ALTER TABLE public.publish_oauth_states ADD CONSTRAINT publish_oauth_states_mode_check
  CHECK (mode IS NULL OR mode IN ('facebook', 'instagram'));

COMMENT ON COLUMN public.publish_oauth_states.mode IS
  'instagram: facebook — вход через Facebook и выбор страниц; instagram — вход в сам Instagram (Instagram Login). У остальных площадок NULL.';

/* ─────────────── 2. отложенный выбор страниц — не только по ссылке ─────────────── */

-- Менеджер в кабинете проходит тот же вход через Facebook, но ссылки у него нет:
-- список страниц кладётся сюда от его имени, выбор делает он же в диалоге.
ALTER TABLE public.publish_connect_pending
  ALTER COLUMN connect_link_id DROP NOT NULL;

ALTER TABLE public.publish_connect_pending
  ADD COLUMN IF NOT EXISTS user_id  uuid,
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.publish_account_groups(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.publish_connect_pending.user_id IS
  'Кто начал подключение из кабинета; NULL — подключение по ссылке-приглашению (доверие даёт connect_link_id).';

-- Страховка от «висячего» выбора: строка без ссылки и без пользователя никому
-- не принадлежит, завершить её было бы некому.
ALTER TABLE public.publish_connect_pending DROP CONSTRAINT IF EXISTS publish_connect_pending_owner_check;
ALTER TABLE public.publish_connect_pending ADD CONSTRAINT publish_connect_pending_owner_check
  CHECK (connect_link_id IS NOT NULL OR user_id IS NOT NULL);
