-- Контент-центр: не считать ботов за клики.
--
-- Событие instagram_organic_events.link_click пишется на КАЖДЫЙ заход по
-- ссылке-редиректу (ig-organic-redirect), включая краулеры предпросмотра
-- (Meta facebookexternalhit при авто-DM, WhatsApp/Telegram и т.п.). Легаси
-- cf_clicks фильтровался по is_bot, а путь organic_events — нет, из-за чего
-- боты попадали в «Клики» и раздували CTR (например, 16 из 20 «кликов» были
-- заходами facebookexternalhit).
--
-- Фикс: в new_post_funnel/unattributed_funnel считаем link_click только для
-- НЕ-ботовых user-agent. Условие вынесено в общий предикат.

CREATE OR REPLACE FUNCTION public.cf_content_center(
  p_from date,
  p_to date,
  p_project_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with b as (
  select p_from::timestamptz as ts_from, ((p_to + 1))::timestamptz as ts_to
),
merged_posts as (
  select
    im.media_id as ig_media_id,
    im.caption,
    im.permalink,
    im.media_type,
    coalesce(im.thumbnail_url, im.media_url) as thumbnail_url,
    im.timestamp as posted_at,
    coalesce(im.reach, 0) as reach,
    coalesce(nullif(im.plays, 0), nullif(im.impressions, 0), 0) as views
  from public.instagram_media im
  where p_project_id is not null and im.project_id = p_project_id
  union all
  select
    p.ig_media_id,
    p.caption,
    p.permalink,
    p.media_type,
    p.thumbnail_url,
    p.posted_at,
    coalesce((select max(s.reach) from public.cf_post_stats s where s.ig_media_id = p.ig_media_id), 0),
    coalesce((select max(s.views) from public.cf_post_stats s where s.ig_media_id = p.ig_media_id), 0)
  from public.cf_posts p
  where p_project_id is null
    and not exists (select 1 from public.instagram_media im2 where im2.media_id = p.ig_media_id)
),
new_post_funnel as (
  select
    e.reel_id as ig_media_id,
    count(*) filter (
      where e.event_type = 'link_click'
        and coalesce(e.payload->>'user_agent','') not ilike '%facebookexternalhit%'
        and coalesce(e.payload->>'user_agent','') !~* '(bot|crawler|spider|preview|facebookcatalog|whatsapp|telegram|slack|discord|vkshare|skypeuripreview)'
    ) as clicks,
    count(distinct e.lead_id) filter (where e.event_type = 'lead' and e.lead_id is not null) as leads,
    count(distinct l.id) filter (where l.diagnostic_amount > 0) as diagnostics,
    count(distinct l.id) filter (where l.paid) as sales,
    coalesce(sum(l.diagnostic_amount) filter (where l.diagnostic_amount > 0), 0) as diagnostic_sum,
    coalesce(sum(l.amount) filter (where l.paid), 0) as sale_sum
  from public.instagram_organic_events e
  left join public.leads l on l.id = e.lead_id
  where e.reel_id is not null
    and p_project_id is not null and e.project_id = p_project_id
  group by e.reel_id
),
unattributed_funnel as (
  select
    count(*) filter (
      where e.event_type = 'link_click'
        and coalesce(e.payload->>'user_agent','') not ilike '%facebookexternalhit%'
        and coalesce(e.payload->>'user_agent','') !~* '(bot|crawler|spider|preview|facebookcatalog|whatsapp|telegram|slack|discord|vkshare|skypeuripreview)'
    ) as clicks,
    count(distinct e.lead_id) filter (where e.event_type = 'lead' and e.lead_id is not null) as leads,
    count(distinct l.id) filter (where l.diagnostic_amount > 0) as diagnostics,
    count(distinct l.id) filter (where l.paid) as sales,
    coalesce(sum(l.diagnostic_amount) filter (where l.diagnostic_amount > 0), 0) as diagnostic_sum,
    coalesce(sum(l.amount) filter (where l.paid), 0) as sale_sum
  from public.instagram_organic_events e
  left join public.leads l on l.id = e.lead_id
  where e.reel_id is null
    and p_project_id is not null and e.project_id = p_project_id
),
post as (
  select
    mp.ig_media_id,
    mp.caption,
    mp.permalink,
    mp.media_type,
    mp.thumbnail_url,
    mp.posted_at,
    mp.reach,
    mp.views,
    coalesce((select array_agg(distinct k.keyword) from public.cf_keywords k where k.ig_media_id = mp.ig_media_id), array[]::text[]) as codewords,
    coalesce((select count(*) from public.cf_clicks c where c.ig_media_id = mp.ig_media_id and c.is_bot = false), 0)
      + coalesce(npf.clicks, 0) as clicks,
    coalesce((select count(*) from public.cf_leads l where l.ig_media_id = mp.ig_media_id), 0)
      + coalesce(npf.leads, 0) as leads,
    coalesce((select count(*) from public.cf_leads l where l.ig_media_id = mp.ig_media_id and l.diagnosed_at is not null), 0)
      + coalesce(npf.diagnostics, 0) as diagnostics,
    coalesce((select count(*) from public.cf_leads l where l.ig_media_id = mp.ig_media_id and l.paid_at is not null), 0)
      + coalesce(npf.sales, 0) as sales,
    coalesce((select sum(pay.amount) from public.cf_payments pay where pay.ig_media_id = mp.ig_media_id and pay.type = 'diagnostic'), 0)
      + coalesce(npf.diagnostic_sum, 0) as diagnostic_sum,
    coalesce((select sum(pay.amount) from public.cf_payments pay where pay.ig_media_id = mp.ig_media_id and pay.type = 'sale'), 0)
      + coalesce(npf.sale_sum, 0) as sale_sum
  from merged_posts mp
  left join new_post_funnel npf on npf.ig_media_id = mp.ig_media_id
  where mp.posted_at >= (select ts_from from b) and mp.posted_at < (select ts_to from b)
),
extra as (
  select * from unattributed_funnel
)
select jsonb_build_object(
  'from', p_from,
  'to',   p_to,
  'posts', coalesce((select jsonb_agg(to_jsonb(post) order by post.posted_at desc nulls last) from post), '[]'::jsonb),
  'totals', (select jsonb_build_object(
      'reach', coalesce((select sum(reach) from post), 0),
      'views', coalesce((select sum(views) from post), 0),
      'clicks', coalesce((select sum(clicks) from post), 0) + coalesce((select clicks from extra), 0),
      'leads', coalesce((select sum(leads) from post), 0) + coalesce((select leads from extra), 0),
      'diagnostics', coalesce((select sum(diagnostics) from post), 0) + coalesce((select diagnostics from extra), 0),
      'diagnostic_sum', coalesce((select sum(diagnostic_sum) from post), 0) + coalesce((select diagnostic_sum from extra), 0),
      'sales', coalesce((select sum(sales) from post), 0) + coalesce((select sales from extra), 0),
      'sale_sum', coalesce((select sum(sale_sum) from post), 0) + coalesce((select sale_sum from extra), 0),
      'revenue', coalesce((select sum(diagnostic_sum) from post), 0) + coalesce((select diagnostic_sum from extra), 0)
                 + coalesce((select sum(sale_sum) from post), 0) + coalesce((select sale_sum from extra), 0)
    )),
  'funnel', (select jsonb_build_object(
      'reach', coalesce((select sum(reach) from post), 0),
      'clicks', coalesce((select sum(clicks) from post), 0) + coalesce((select clicks from extra), 0),
      'leads', coalesce((select sum(leads) from post), 0) + coalesce((select leads from extra), 0),
      'diagnostics', coalesce((select sum(diagnostics) from post), 0) + coalesce((select diagnostics from extra), 0),
      'sales', coalesce((select sum(sales) from post), 0) + coalesce((select sales from extra), 0)
    ))
);
$function$;
