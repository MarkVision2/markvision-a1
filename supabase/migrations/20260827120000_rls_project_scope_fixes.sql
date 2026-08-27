-- Выравнивание RLS по проектной изоляции.
--
-- Что чинится:
--   1. events — любой авторизованный пользователь читал ВСЕ строки с
--      lead_id IS NULL (в payload автоматизаций лежат project_id, тексты
--      сообщений, CAPI-детали). При этом участник проекта НЕ видел события
--      лидов своего проекта, если лид не назначен на него.
--   2. communications / tasks — SELECT и UPDATE уже проектные, а INSERT
--      требовал, чтобы лид был назначен на тебя или создан тобой: участник
--      проекта не мог записать звонок/сообщение или поставить задачу по
--      лиду своего проекта.
--   3. client_dashboard_tokens — RLS включён без единой политики (deny-all),
--      но экран «Настройки → доступ клиента» читает и пишет эту таблицу.
--      Список всегда пустой, создание падало, а «Отозвать доступ» молча не
--      срабатывал — ссылка клиента оставалась рабочей.
--   4. client_configs — INSERT/UPDATE/DELETE были открыты любому
--      авторизованному пользователю без привязки к проекту. Прямая запись из
--      браузера давно убрана (идёт через edge client-config-sync под service
--      role), поэтому запись роли authenticated просто снимаем.

-- ============================================================
-- 1) events — доступ строго через видимость лида
-- ============================================================
DROP POLICY IF EXISTS events_select_via_lead ON public.events;
CREATE POLICY events_select_scoped ON public.events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = events.lead_id
        AND (
          (l.project_id IS NOT NULL AND public.user_can_access_project(l.project_id))
          OR (l.project_id IS NULL AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS events_insert_via_lead ON public.events;
CREATE POLICY events_insert_scoped ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = events.lead_id
        AND (
          (l.project_id IS NOT NULL AND public.user_can_access_project(l.project_id))
          OR (l.project_id IS NULL AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
        )
    )
  );

-- ============================================================
-- 2) communications / tasks — INSERT по правам на проект лида
-- ============================================================
DROP POLICY IF EXISTS comm_insert_authed ON public.communications;
CREATE POLICY comm_insert_scoped ON public.communications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = communications.lead_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR (l.project_id IS NOT NULL AND public.user_can_access_project(l.project_id))
          OR (l.project_id IS NULL AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS tasks_insert_via_lead ON public.tasks;
CREATE POLICY tasks_insert_scoped ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR (l.project_id IS NOT NULL AND public.user_can_access_project(l.project_id))
          OR (l.project_id IS NULL AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS tasks_select_visible ON public.tasks;
CREATE POLICY tasks_select_scoped ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id
        AND (
          (l.project_id IS NOT NULL AND public.user_can_access_project(l.project_id))
          OR (l.project_id IS NULL AND (l.assigned_to = auth.uid() OR l.created_by = auth.uid()))
        )
    )
  );

DROP POLICY IF EXISTS tasks_update_visible ON public.tasks;
CREATE POLICY tasks_update_scoped ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id
        AND l.project_id IS NOT NULL
        AND public.user_can_access_project(l.project_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = tasks.lead_id
        AND l.project_id IS NOT NULL
        AND public.user_can_access_project(l.project_id)
    )
  );

-- ============================================================
-- 3) client_dashboard_tokens — управление только админом
-- ============================================================
-- Таблица заведена вне миграций (Supabase UI) — работаем только если она есть.
DO $$
BEGIN
  IF to_regclass('public.client_dashboard_tokens') IS NULL THEN
    RAISE NOTICE 'client_dashboard_tokens отсутствует — пропускаем';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.client_dashboard_tokens ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS client_dashboard_tokens_admin ON public.client_dashboard_tokens';
  EXECUTE $pol$
    CREATE POLICY client_dashboard_tokens_admin ON public.client_dashboard_tokens
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'admin'))
      WITH CHECK (public.has_role(auth.uid(), 'admin'))
  $pol$;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_dashboard_tokens TO authenticated';
END $$;

-- ============================================================
-- 4) client_configs — снимаем неограниченную запись у authenticated
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.client_configs') IS NULL THEN
    RAISE NOTICE 'client_configs отсутствует — пропускаем';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS client_configs_insert_authed ON public.client_configs';
  EXECUTE 'DROP POLICY IF EXISTS client_configs_update_authed ON public.client_configs';
  EXECUTE 'DROP POLICY IF EXISTS client_configs_delete_authed ON public.client_configs';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.client_configs FROM authenticated';
END $$;
