-- Ужесточение RLS на очереди запусков.
--
-- В 20260901090000 политики чтения были написаны как
--   USING (project_id IS NULL OR public.user_can_access_project(project_id))
-- Ветка `project_id IS NULL` открывала строки любому авторизованному
-- пользователю: задание без проекта (мастер мог не передать project_id)
-- становилось видно всем, а в spec лежат бюджет, тексты объявления, сайт
-- и номер WhatsApp клиента.
--
-- Приводим к тому же правилу, по которому живёт ad_campaigns
-- (ad_campaigns_select_scoped): без проекта — не видно никому, кроме
-- service_role, который RLS не касается.

DROP POLICY IF EXISTS ad_launch_jobs_select_scoped ON public.ad_launch_jobs;
CREATE POLICY ad_launch_jobs_select_scoped ON public.ad_launch_jobs
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));

DROP POLICY IF EXISTS ad_launch_schedules_select_scoped ON public.ad_launch_schedules;
CREATE POLICY ad_launch_schedules_select_scoped ON public.ad_launch_schedules
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
