-- Трекинг переходов по ссылке и конверсий рассылки.

-- 1) Целевая ссылка кампании + токен перехода на получателя.
alter table public.broadcast_campaigns add column if not exists target_url text;
alter table public.broadcast_recipients add column if not exists click_token text;

update public.broadcast_recipients
set click_token = replace(gen_random_uuid()::text, '-', '')
where click_token is null;

alter table public.broadcast_recipients
  alter column click_token set default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists broadcast_recipients_click_token_idx
  on public.broadcast_recipients (click_token) where click_token is not null;

-- 2) Конверсия: лид дошёл до «оплачен/предоплата» → помечаем получателя
--    рассылки converted. Матч по lead_id ИЛИ телефону (новая заявка с сайта
--    на тот же номер тоже засчитается), окно 30 дней от отправки.
create or replace function public.broadcast_mark_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _key text;
  _role text;
  _d text;
begin
  select key, stage_role into _key, _role from public.pipeline_stages where id = NEW.stage_id;
  if _key is null then return NEW; end if;
  if _key not in ('paid', 'deposit') and coalesce(_role, '') not in ('paid', 'deposit') then
    return NEW;
  end if;

  _d := regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g');
  if length(_d) < 8 then return NEW; end if;

  update public.broadcast_recipients r
  set status = 'converted', converted_at = now()
  where (r.lead_id = NEW.id or r.phone in ('+' || _d, _d))
    and (NEW.project_id is null or r.project_id = NEW.project_id)
    and r.status in ('sent', 'delivered', 'read', 'replied', 'clicked')
    and r.sent_at is not null
    and r.sent_at > now() - interval '30 days';

  return NEW;
end;
$$;

drop trigger if exists trg_leads_broadcast_conversion on public.leads;
create trigger trg_leads_broadcast_conversion
  after insert or update of stage_id on public.leads
  for each row execute function public.broadcast_mark_conversion();
