-- Делаем движок "код-слово → автоответ на комментарий → DM" и автопостинг
-- мультитенантными: привязываем их к instagram_accounts/instagram_codewords
-- конкретного проекта вместо одного глобального аккаунта в cf_settings.

-- 1) Код-слова: текст публичного ответа на комментарий + текст DM (ссылка уже
--    есть в target_url). Оба поля опциональны — если reply_text пуст,
--    публичный ответ на комментарий не публикуется.
ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS reply_text text,
  ADD COLUMN IF NOT EXISTS dm_text text;

-- 2) Быстрый поиск проекта по ig_user_id из вебхука Meta.
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user_id
  ON public.instagram_accounts(ig_user_id);

-- 3) Идемпотентность обработки вебхука: один комментарий не должен
--    порождать повторный автоответ/DM при ретраях Meta.
ALTER TABLE public.instagram_organic_events
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_organic_events_external_id
  ON public.instagram_organic_events(external_id)
  WHERE external_id IS NOT NULL;

-- 4) Автопостинг по проектам: очередь постов привязывается к проекту.
--    NULL остаётся для уже существующих записей старого единого клиента —
--    publisher продолжает обслуживать их через глобальный cf_settings.
ALTER TABLE public.cf_scheduled_posts
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cf_scheduled_posts_project
  ON public.cf_scheduled_posts(project_id, scheduled_at);
