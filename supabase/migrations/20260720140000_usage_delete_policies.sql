-- Allow project members to delete finished Reels / HeyGen gallery rows.
-- Previously only SELECT + INSERT existed, so the UI could not remove videos.

drop policy if exists reels_usage_delete on public.reels_usage;
create policy reels_usage_delete on public.reels_usage
  for delete to authenticated
  using (project_id in (select id from public.projects));

drop policy if exists heygen_usage_delete on public.heygen_usage;
create policy heygen_usage_delete on public.heygen_usage
  for delete to authenticated
  using (project_id in (select id from public.projects));
