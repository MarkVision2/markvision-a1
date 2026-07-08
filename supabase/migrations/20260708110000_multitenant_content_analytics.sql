-- Делаем "Контент-аналитику" (cf_content_analytics) и heatmap автопостинга
-- (cf_autopost_stats) мультитенантными: при переданном p_project_id данные
-- берутся из уже мультитенантных таблиц (instagram_media, instagram_account_daily,
-- content_factory_gallery) вместо единого глобального cf_posts/cf_post_stats/
-- cf_follower_snapshots. Без project_id (p_project_id IS NULL) поведение не
-- меняется — старый единый клиент продолжает работать как раньше.
--
-- "Контент-центр" (cf_content_center) сюда намеренно не входит: его воронка
-- лиды → диагностика → продажа завязана на бес пример WhatsApp+Kaspi пайплайн
-- (cf_leads/cf_payments) конкретного клиента — это отдельная большая задача
-- (нужен аналог lead-capture + оплаты per project), не часть этой миграции.

-- Drop old 2-arg signatures first — otherwise PostgREST calls with just
-- {p_from, p_to} become ambiguous between the old function and the new
-- 3-arg one with a default.
DROP FUNCTION IF EXISTS public.cf_content_analytics(date, date);
DROP FUNCTION IF EXISTS public.cf_autopost_stats(date, date);

CREATE OR REPLACE FUNCTION public.cf_content_analytics(p_from date, p_to date, p_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with b as (
  select p_from::timestamptz as ts_from,
         (p_to + 1)::timestamptz as ts_to,
         (p_from - (p_to - p_from + 1))::timestamptz as pts_from,
         p_from::timestamptz as pts_to
),
stats as (
  select s.ig_media_id,
         max(s.reach) reach, max(s.views) views,
         max(s.likes) likes, max(s.comments) comments,
         max(s.saved) saved, max(s.shares) shares,
         max(s.total_interactions) ti
  from public.cf_post_stats s group by s.ig_media_id
),
postm as (
  select m.media_id as ig_media_id, m.caption, m.permalink, m.media_type, m.thumbnail_url, m.timestamp as posted_at,
         coalesce(m.reach,0) reach, coalesce(greatest(m.video_views,m.plays),0) views,
         coalesce(m.total_interactions, m.like_count+m.comments_count+m.saved_count+m.shares_count, 0) engagement,
         coalesce(m.saved_count,0) saved, coalesce(m.shares_count,0) shares
  from public.instagram_media m
  where p_project_id is not null and m.project_id = p_project_id
    and m.timestamp >= (select ts_from from b) and m.timestamp < (select ts_to from b)
  union all
  select p.ig_media_id, p.caption, p.permalink, p.media_type, p.thumbnail_url, p.posted_at,
         coalesce(st.reach,0), coalesce(st.views,0),
         greatest(coalesce(st.ti,0), coalesce(st.likes,0)+coalesce(st.comments,0)+coalesce(st.saved,0)+coalesce(st.shares,0)),
         coalesce(st.saved,0), coalesce(st.shares,0)
  from public.cf_posts p
  left join stats st on st.ig_media_id = p.ig_media_id
  where p_project_id is null
    and p.posted_at >= (select ts_from from b) and p.posted_at < (select ts_to from b)
),
pm as (
  select *, case when reach>0 then round(engagement::numeric/reach*100,2) else 0 end er from postm
),
prevm as (
  select m.media_id as ig_media_id, coalesce(m.reach,0) reach,
         coalesce(m.total_interactions, m.like_count+m.comments_count+m.saved_count+m.shares_count, 0) engagement
  from public.instagram_media m
  where p_project_id is not null and m.project_id = p_project_id
    and m.timestamp >= (select pts_from from b) and m.timestamp < (select pts_to from b)
  union all
  select p.ig_media_id, coalesce(st.reach,0),
         greatest(coalesce(st.ti,0), coalesce(st.likes,0)+coalesce(st.comments,0)+coalesce(st.saved,0)+coalesce(st.shares,0))
  from public.cf_posts p
  left join stats st on st.ig_media_id = p.ig_media_id
  where p_project_id is null
    and p.posted_at >= (select pts_from from b) and p.posted_at < (select pts_to from b)
),
foll_now as (
  select followers_count from public.cf_follower_snapshots
  where p_project_id is null
  order by snapshot_date desc limit 1
),
foll_now_pt as (
  select followers from public.instagram_account_daily
  where p_project_id is not null and project_id = p_project_id
  order by date desc limit 1
),
foll_growth_pt as (
  select
    (select followers from public.instagram_account_daily where project_id = p_project_id and date <= p_to order by date desc limit 1)
    - coalesce((select followers from public.instagram_account_daily where project_id = p_project_id and date < p_from order by date desc limit 1),
      (select followers from public.instagram_account_daily where project_id = p_project_id and date <= p_to order by date desc limit 1)) as growth
),
foll_series_pt as (
  select date, followers from public.instagram_account_daily
  where p_project_id is not null and project_id = p_project_id and date >= p_from and date <= p_to
  order by date
)
select jsonb_build_object(
  'from', p_from, 'to', p_to,
  'kpis', (select jsonb_build_object(
      'posts', count(*),
      'reach', coalesce(sum(reach),0),
      'views', coalesce(sum(views),0),
      'engagement', coalesce(sum(engagement),0),
      'saves', coalesce(sum(saved),0),
      'shares', coalesce(sum(shares),0),
      'er', case when coalesce(sum(reach),0)>0 then round(sum(engagement)::numeric/sum(reach)*100,2) else 0 end,
      'reach_prev', (select coalesce(sum(reach),0) from prevm),
      'engagement_prev', (select coalesce(sum(engagement),0) from prevm),
      'posts_prev', (select count(*) from prevm),
      'er_prev', (select case when coalesce(sum(reach),0)>0 then round(sum(engagement)::numeric/sum(reach)*100,2) else 0 end from prevm)
    ) from pm),
  'trend', coalesce((select jsonb_agg(jsonb_build_object(
      'week', wk, 'posts', posts, 'reach', reach, 'views', views, 'engagement', engagement, 'er', er
    ) order by wk) from (
      select date_trunc('week', posted_at)::date wk, count(*) posts, sum(reach) reach, sum(views) views,
             sum(engagement) engagement,
             case when sum(reach)>0 then round(sum(engagement)::numeric/sum(reach)*100,2) else 0 end er
      from pm group by 1
    ) t), '[]'::jsonb),
  'by_format', coalesce((select jsonb_agg(jsonb_build_object(
      'media_type', media_type, 'posts', posts, 'avg_reach', avg_reach, 'avg_views', avg_views,
      'engagement', engagement, 'er', er
    ) order by posts desc) from (
      select media_type, count(*) posts, round(avg(reach)) avg_reach, round(avg(views)) avg_views,
             sum(engagement) engagement,
             case when sum(reach)>0 then round(sum(engagement)::numeric/sum(reach)*100,2) else 0 end er
      from pm group by 1
    ) f), '[]'::jsonb),
  'top_posts', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('ig_media_id', ig_media_id, 'caption', left(coalesce(caption,''),120),
        'permalink', permalink, 'media_type', media_type, 'thumbnail_url', thumbnail_url,
        'posted_at', posted_at, 'reach', reach, 'views', views, 'engagement', engagement, 'er', er) x
      from pm order by er desc, reach desc limit 5
    ) tp), '[]'::jsonb),
  'bottom_posts', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('ig_media_id', ig_media_id, 'caption', left(coalesce(caption,''),120),
        'permalink', permalink, 'media_type', media_type, 'thumbnail_url', thumbnail_url,
        'posted_at', posted_at, 'reach', reach, 'views', views, 'engagement', engagement, 'er', er) x
      from pm order by er asc, reach asc limit 5
    ) bp), '[]'::jsonb),
  'followers', jsonb_build_object(
      'now', case when p_project_id is not null then (select followers from foll_now_pt) else (select followers_count from foll_now) end,
      'growth', case when p_project_id is not null then coalesce((select growth from foll_growth_pt),0)
                     else coalesce((select sum(net_change) from public.cf_follower_snapshots where p_project_id is null and snapshot_date>=p_from and snapshot_date<=p_to),0) end,
      'series', case when p_project_id is not null then
          coalesce((select jsonb_agg(jsonb_build_object('date', date, 'followers', followers, 'net', null) order by date) from foll_series_pt), '[]'::jsonb)
        else
          coalesce((select jsonb_agg(jsonb_build_object('date', snapshot_date, 'followers', followers_count, 'net', net_change) order by snapshot_date)
                 from public.cf_follower_snapshots where p_project_id is null and snapshot_date>=p_from and snapshot_date<=p_to), '[]'::jsonb)
        end
    ),
  'production', jsonb_build_object(
      'generated', (select count(*) from public.content_factory_gallery
                    where (p_project_id is null or project_id = p_project_id)
                      and created_at >= (select ts_from from b) and created_at < (select ts_to from b)),
      'published', (select count(*) from pm),
      'generated_all', (select count(*) from public.content_factory_gallery where p_project_id is null or project_id = p_project_id)
    )
);
$function$;

CREATE OR REPLACE FUNCTION public.cf_autopost_stats(p_from date, p_to date, p_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
with pm as (
  select
    (m.timestamp at time zone 'Asia/Almaty') as local_ts,
    coalesce(m.reach,0) as reach,
    coalesce(m.total_interactions, m.like_count+m.comments_count+m.saved_count+m.shares_count, 0) as inter
  from public.cf_scheduled_posts sp
  join public.instagram_media m on m.media_id = sp.published_ig_media_id
  where p_project_id is not null and sp.project_id = p_project_id and sp.status = 'published'
  union all
  select
    (p.posted_at at time zone 'Asia/Almaty'),
    coalesce((select max(s.reach) from public.cf_post_stats s where s.ig_media_id = p.ig_media_id), 0),
    coalesce((select max(s.total_interactions) from public.cf_post_stats s where s.ig_media_id = p.ig_media_id), 0)
  from public.cf_posts p
  where p_project_id is null and p.posted_at is not null
),
wd as (
  select extract(dow from local_ts)::int as dow, count(*) as posts,
         round(avg(reach))::int as avg_reach, round(avg(inter))::int as avg_inter
  from pm group by 1
),
hr as (
  select extract(hour from local_ts)::int as hour, count(*) as posts,
         round(avg(reach))::int as avg_reach, round(avg(inter))::int as avg_inter
  from pm group by 1
),
hm as (
  select extract(dow from local_ts)::int as dow, extract(hour from local_ts)::int as hour,
         count(*) as posts, round(avg(reach))::int as avg_reach
  from pm group by 1, 2
)
select jsonb_build_object(
  'total_posts', (select count(*) from pm),
  'published_this_period', (
    select count(*) from public.cf_scheduled_posts
    where (p_project_id is not null and project_id = p_project_id or p_project_id is null and project_id is null)
      and status = 'published' and scheduled_at >= p_from::timestamptz and scheduled_at < (p_to + 1)::timestamptz
  ),
  'scheduled_upcoming', (
    select count(*) from public.cf_scheduled_posts
    where (p_project_id is not null and project_id = p_project_id or p_project_id is null and project_id is null)
      and status in ('queued','processing') and scheduled_at >= now()
  ),
  'by_weekday', coalesce((select jsonb_agg(jsonb_build_object('dow',dow,'posts',posts,'avg_reach',avg_reach,'avg_inter',avg_inter) order by dow) from wd), '[]'::jsonb),
  'by_hour',    coalesce((select jsonb_agg(jsonb_build_object('hour',hour,'posts',posts,'avg_reach',avg_reach,'avg_inter',avg_inter) order by hour) from hr), '[]'::jsonb),
  'heatmap',    coalesce((select jsonb_agg(jsonb_build_object('dow',dow,'hour',hour,'posts',posts,'avg_reach',avg_reach)) from hm), '[]'::jsonb),
  'best_weekday', coalesce(
      (select dow from wd where posts >= 2 order by avg_reach desc, posts desc limit 1),
      (select dow from wd order by posts desc, avg_reach desc limit 1)),
  'best_hour', coalesce(
      (select hour from hr where posts >= 2 order by avg_reach desc, posts desc limit 1),
      (select hour from hr order by posts desc, avg_reach desc limit 1)),
  'best_slots', coalesce((select jsonb_agg(x) from (
      select dow, hour, posts, avg_reach from hm where posts >= 2 order by avg_reach desc, posts desc limit 3) x),
      coalesce((select jsonb_agg(x) from (
      select dow, hour, posts, avg_reach from hm order by posts desc, avg_reach desc limit 3) x), '[]'::jsonb))
);
$function$;
