-- Масштабирование монтаж-конвейера: атомарный забор заявки.
-- Несколько воркеров могут разбирать очередь параллельно — FOR UPDATE SKIP LOCKED
-- гарантирует, что одну заявку возьмёт ровно один. Заодно возвращаем в очередь
-- заявки, чей воркер умер посреди монтажа (processing/rendering дольше 3 часов).
-- Вызывается только service role из edge-функции montage-worker (rpc).

create or replace function public.claim_montage_job()
returns setof public.montage_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.montage_jobs
     set status = 'queued',
         progress = 'возвращена в очередь после сбоя воркера',
         claimed_at = null,
         updated_at = now()
   where status in ('processing', 'rendering')
     and claimed_at < now() - interval '3 hours';

  return query
  update public.montage_jobs mj
     set status = 'processing',
         progress = 'взято в работу',
         claimed_at = now(),
         updated_at = now()
   where mj.id = (
     select id from public.montage_jobs
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1)
  returning mj.*;
end;
$$;

revoke all on function public.claim_montage_job() from public;
revoke all on function public.claim_montage_job() from anon;
revoke all on function public.claim_montage_job() from authenticated;
