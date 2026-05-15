-- Скрытие "личных" заявок из CRM.
-- Если в личный WhatsApp пишет не клиент, а кто-то из контактов владельца,
-- такую заявку можно перевести в "личные" — после этого она исчезает из всех
-- выборок CRM (воронка, чаты, база, аналитика, дашборд) и больше нигде не учитывается.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

-- Частичный индекс — почти все строки имеют is_personal = false,
-- так что отдельный индекс по флагу бесполезен. Но индекс по (project_id) WHERE NOT is_personal
-- ускорит самый частый запрос: «лиды активного проекта, не личные».
CREATE INDEX IF NOT EXISTS leads_active_by_project_idx
  ON public.leads (project_id, created_at DESC)
  WHERE is_personal = false;
