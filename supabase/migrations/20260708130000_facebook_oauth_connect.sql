-- Полноценный вход через Facebook: один клик → грант на страницу + рекламный
-- кабинет + Instagram-аккаунт → система сама забирает всё и подключает.
--
-- meta_oauth_states — короткоживущие одноразовые state-токены OAuth-потока.
-- facebook-oauth-start (authenticated) создаёт строку, привязывая state к
-- project_id и user_id (иначе callback от Meta не может доверять project_id,
-- присланному в query-параметре). facebook-oauth-callback (публичный, его
-- дёргает Meta) находит строку по state, проверяет срок жизни и одноразовость,
-- затем удаляет её.
CREATE TABLE IF NOT EXISTS public.meta_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  return_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_oauth_states_created_at ON public.meta_oauth_states(created_at);

ALTER TABLE public.meta_oauth_states ENABLE ROW LEVEL SECURITY;
-- Только service_role читает/пишет (обе edge-функции используют service role).
REVOKE ALL ON public.meta_oauth_states FROM authenticated, anon;
GRANT ALL ON public.meta_oauth_states TO service_role;
