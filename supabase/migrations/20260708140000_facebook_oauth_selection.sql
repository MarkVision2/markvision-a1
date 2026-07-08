-- Когда у Facebook-аккаунта больше одной страницы или рекламного кабинета,
-- facebook-oauth-callback больше не угадывает первую попавшуюся — он
-- складывает список сюда и просит пользователя явно выбрать
-- (facebook-oauth-finish подхватывает выбор и завершает подключение).
CREATE TABLE IF NOT EXISTS public.meta_oauth_pending_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_token text NOT NULL,
  pages jsonb NOT NULL,
  ad_accounts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_oauth_pending_selections_created_at ON public.meta_oauth_pending_selections(created_at);

ALTER TABLE public.meta_oauth_pending_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_oauth_pending_selections FROM authenticated, anon;
GRANT ALL ON public.meta_oauth_pending_selections TO service_role;
