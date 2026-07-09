-- "Контент-центр" брал список постов ИСКЛЮЧИТЕЛЬНО из cf_posts — таблицы,
-- которую наполняет отдельный легаси-пайплайн (collect-stats, cron 19:00 UTC,
-- свой ig_access_token в cf_settings). Этот пайплайн перестал успешно
-- обновлять cf_posts после 2026-06-17 (свежих постов, включая рилс, вручную
-- опубликованный вчера, там просто нет как строк). Из-за этого весь раздел
-- показывал нули не потому что охватов нет, а потому что самого поста в
-- cf_posts не было.
--
-- Реальные и актуальные данные по постам (включая reach/views) уже есть в
-- instagram_media — её наполняет instagram-sync, которая теперь работает
-- корректно и по расписанию (see 20260709090000_instagram_sync_cron.sql).
-- Переключаем источник постов + reach/views на instagram_media, оставляя
-- cf_posts как fallback только для исторических постов, которых там нет
-- (клики/лиды/оплаты по-прежнему считаются из старых cf_* таблиц — это
-- отдельная, более глубокая миграция, не в этом фиксе).
create or replace function public.cf_content_center(p_from date, p_to date)
returns jsonb
language sql
stable
as $function$
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
  where not exists (select 1 from public.instagram_media im2 where im2.media_id = p.ig_media_id)
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
    coalesce((select count(*) from public.cf_clicks c where c.ig_media_id = mp.ig_media_id and c.is_bot = false), 0) as clicks,
    coalesce((select count(*) from public.cf_leads l where l.ig_media_id = mp.ig_media_id), 0) as leads,
    coalesce((select count(*) from public.cf_leads l where l.ig_media_id = mp.ig_media_id and l.diagnosed_at is not null), 0) as diagnostics,
    coalesce((select count(*) from public.cf_leads l where l.ig_media_id = mp.ig_media_id and l.paid_at is not null), 0) as sales,
    coalesce((select sum(pay.amount) from public.cf_payments pay where pay.ig_media_id = mp.ig_media_id and pay.type = 'diagnostic'), 0) as diagnostic_sum,
    coalesce((select sum(pay.amount) from public.cf_payments pay where pay.ig_media_id = mp.ig_media_id and pay.type = 'sale'), 0) as sale_sum
  from merged_posts mp
  where mp.posted_at >= (select ts_from from b) and mp.posted_at < (select ts_to from b)
)
select jsonb_build_object(
  'from', p_from,
  'to',   p_to,
  'posts', coalesce((select jsonb_agg(to_jsonb(post) order by post.posted_at desc nulls last) from post), '[]'::jsonb),
  'totals', (select jsonb_build_object(
      'reach', coalesce(sum(reach),0), 'views', coalesce(sum(views),0),
      'clicks', coalesce(sum(clicks),0), 'leads', coalesce(sum(leads),0),
      'diagnostics', coalesce(sum(diagnostics),0), 'diagnostic_sum', coalesce(sum(diagnostic_sum),0),
      'sales', coalesce(sum(sales),0), 'sale_sum', coalesce(sum(sale_sum),0),
      'revenue', coalesce(sum(diagnostic_sum),0) + coalesce(sum(sale_sum),0)
    ) from post),
  'funnel', (select jsonb_build_object(
      'reach', coalesce(sum(reach),0), 'clicks', coalesce(sum(clicks),0),
      'leads', coalesce(sum(leads),0), 'diagnostics', coalesce(sum(diagnostics),0),
      'sales', coalesce(sum(sales),0)
    ) from post)
);
$function$;
