-- Запусти в SQL Editor НОВОГО проекта (szfgdruhlebfvcmlvxdk).
-- Источник: ad_cabinets-export-2026-05-10_15-12-06.csv (старый Lovable Supabase).

insert into public.client_config (
  cabinet_id, name, type, daily_budget, city,
  ad_account_id, page_id, page_name, instagram_id, access_token,
  telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, brief
) values (
  '13825a8f-d620-45dd-8fe4-abee1f9d224d'::uuid,
  'Мир без границ',
  'Личный',
  0,
  'Алматы',
  'act_987225436848235',
  '386900038793389',
  null,
  '17841403668764729',
  'EAANaVrGsWLYBQx2zJZCYxaz16KSfXDHFwIZA5xuZACh8fXnWD1gHcu4YryOs5lCcydaQ0f0D0EhDteeIZBMpD99QBy2a5BEB6JULlKi81zgQIjqnXo46dixFo1NB0BdHo1wAQkJ1fwdiZAqtg5AY2DY8XLDDPIMsJJbUkkhtswZCt48Vw8WuU5Ml5es1X9egMK',
  null,
  '+77058870644',
  '1327704955903997',
  'Lead',
  'https://mir-bez-granic-almaty.lovable.app',
  null
)
on conflict (cabinet_id) do update set
  name              = excluded.name,
  type              = excluded.type,
  daily_budget      = excluded.daily_budget,
  city              = excluded.city,
  ad_account_id     = excluded.ad_account_id,
  page_id           = excluded.page_id,
  instagram_id      = excluded.instagram_id,
  access_token      = excluded.access_token,
  whatsapp_number   = excluded.whatsapp_number,
  pixel_id          = excluded.pixel_id,
  pixel_event       = excluded.pixel_event,
  website_url       = excluded.website_url;
