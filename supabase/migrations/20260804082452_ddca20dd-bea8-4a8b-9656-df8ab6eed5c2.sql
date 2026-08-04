drop policy if exists "leads_insert_authed" on public.leads;
create policy "leads_insert_authed"
on public.leads
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (assigned_to is null or assigned_to = auth.uid() or has_role(auth.uid(), 'admin'::app_role))
  and (
    has_role(auth.uid(), 'admin'::app_role)
    or (project_id is not null and user_can_access_project(project_id))
  )
);

drop policy if exists "meta_tokens_select_admin" on public.meta_tokens;
drop policy if exists "meta_tokens_write_admin" on public.meta_tokens;

create policy "meta_tokens_select_admin"
on public.meta_tokens
for select
to authenticated
using (
  user_can_access_project(project_id)
  and (
    has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.projects p
      where p.id = meta_tokens.project_id and p.created_by = auth.uid()
    )
  )
);

create policy "meta_tokens_write_admin"
on public.meta_tokens
for all
to authenticated
using (
  user_can_access_project(project_id)
  and (
    has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.projects p
      where p.id = meta_tokens.project_id and p.created_by = auth.uid()
    )
  )
)
with check (
  user_can_access_project(project_id)
  and (
    has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.projects p
      where p.id = meta_tokens.project_id and p.created_by = auth.uid()
    )
  )
);

drop policy if exists "rop_trainer_update" on public.ai_rop_trainer_sessions;
drop policy if exists "rop_trainer_delete" on public.ai_rop_trainer_sessions;

create policy "rop_trainer_update"
on public.ai_rop_trainer_sessions
for update
to authenticated
using (
  user_id = auth.uid()
  or (
    project_id is not null
    and user_can_access_project(project_id)
    and has_role(auth.uid(), 'admin'::app_role)
  )
)
with check (
  user_id = auth.uid()
  or (
    project_id is not null
    and user_can_access_project(project_id)
    and has_role(auth.uid(), 'admin'::app_role)
  )
);

create policy "rop_trainer_delete"
on public.ai_rop_trainer_sessions
for delete
to authenticated
using (
  user_id = auth.uid()
  or (
    project_id is not null
    and user_can_access_project(project_id)
    and has_role(auth.uid(), 'admin'::app_role)
  )
);
