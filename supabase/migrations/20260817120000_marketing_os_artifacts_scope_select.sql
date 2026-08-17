-- Изоляция данных для клиентского доступа: артефакты Marketing OS (стратегия проекта)
-- читались любым залогиненным (USING true) — внешний клиент мог прочитать чужой проект.
-- Скоупим SELECT по проекту. Админ по-прежнему видит всё через существующую
-- политику marketing_os_artifacts_write_admin (FOR ALL), поэтому доступ админа не теряется.

DROP POLICY IF EXISTS marketing_os_artifacts_select_authed ON public.marketing_os_artifacts;
-- Идемпотентность: миграция уже могла быть применена вручную (apply_migration).
DROP POLICY IF EXISTS marketing_os_artifacts_select_scoped ON public.marketing_os_artifacts;

CREATE POLICY marketing_os_artifacts_select_scoped
  ON public.marketing_os_artifacts
  FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
