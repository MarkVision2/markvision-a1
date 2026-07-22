-- Атомарный «захват» получателей воркером: помечает до _limit готовых строк
-- как 'sending' и возвращает их. FOR UPDATE SKIP LOCKED гарантирует, что два
-- одновременно запущенных воркера возьмут РАЗНЫЕ строки — исключает двойную
-- отправку одному человеку при перекрывающихся тиках крона.
create or replace function public.broadcast_claim_recipients(_campaign_id uuid, _limit int)
returns setof public.broadcast_recipients
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.broadcast_recipients r
  set status = 'sending', updated_at = now()
  where r.id in (
    select id from public.broadcast_recipients
    where campaign_id = _campaign_id
      and status = 'queued'
      and (scheduled_at is null or scheduled_at <= now())
    order by created_at
    for update skip locked
    limit greatest(_limit, 0)
  )
  returning r.*;
end;
$$;

revoke all on function public.broadcast_claim_recipients(uuid, int) from public, anon, authenticated;
