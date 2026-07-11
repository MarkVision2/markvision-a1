-- P0: убрать межтенантную утечку — SELECT был USING(true) для всех authenticated.
drop policy if exists capi_outbox_select_authed on public.capi_outbox;
create policy capi_outbox_select_scoped on public.capi_outbox
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or (project_id is not null and public.user_can_access_project(project_id))
  );

drop policy if exists stage_map_select_authed on public.crm_stage_map;
create policy stage_map_select_scoped on public.crm_stage_map
  for select to authenticated
  using (
    project_id is null
    or public.has_role(auth.uid(), 'admin'::app_role)
    or public.user_can_access_project(project_id)
  );
