-- ШАГ 1. Запусти в SQL Editor СТАРОГО проекта (mekwfbqmsqiborjdrjxc).
-- Результат — одна строка с готовым INSERT-стейтментом.
-- Скопируй её содержимое и выполни в SQL Editor НОВОГО проекта (szfgdruhlebfvcmlvxdk).

select format(
  $sql$
  insert into public.client_config (
    cabinet_id, name, type, daily_budget, city,
    ad_account_id, page_id, page_name, instagram_id, access_token,
    telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, brief
  ) values (
    %L::uuid, %L, %L, %s, %L,
    %L, %L, %L, %L, %L,
    %L, %L, %L, %L, %L, %L
  )
  on conflict (cabinet_id) do update set
    name = excluded.name,
    type = excluded.type,
    daily_budget = excluded.daily_budget,
    city = excluded.city,
    ad_account_id = excluded.ad_account_id,
    page_id = excluded.page_id,
    page_name = excluded.page_name,
    instagram_id = excluded.instagram_id,
    access_token = excluded.access_token,
    telegram_group_id = excluded.telegram_group_id,
    whatsapp_number = excluded.whatsapp_number,
    pixel_id = excluded.pixel_id,
    pixel_event = excluded.pixel_event,
    website_url = excluded.website_url,
    brief = excluded.brief;
  $sql$,
  c.id, c.name, c.type,
  coalesce(c.daily_budget::text, 'null'),
  c.city,
  c.ad_account_id, c.page_id, c.page_name, c.instagram_id, c.access_token,
  c.telegram_group_id, c.whatsapp_number, c.pixel_id, c.pixel_event, c.website_url, c.brief
) as insert_sql
from public.ad_cabinets c
where c.name ilike '%мир%без%границ%'
order by c.created_at desc
limit 1;
