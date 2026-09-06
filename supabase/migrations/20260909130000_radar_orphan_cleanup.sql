-- Радар идей: чистка постов от уже удалённых источников и защита на будущее.
--
-- `radar_posts.source_id` ссылался на источник с `ON DELETE SET NULL`, поэтому
-- удаление конкурента оставляло его посты в ленте «Тренды» — без источника и
-- без возможности отличить их от постов, разобранных по прямой ссылке.
-- Теперь связь каскадная: удалили источник — ушли и его посты (RPC
-- radar_delete_source делает то же явно и чистит идеи).
--
-- Разово убираем уже накопившихся «сирот»: посты без источника, чей автор не
-- совпадает ни с одним источником проекта и которые не приходили через
-- «Разобрать ссылку» (такие остаются — их добавляли руками).

ALTER TABLE public.radar_posts DROP CONSTRAINT IF EXISTS radar_posts_source_id_fkey;
ALTER TABLE public.radar_posts
  ADD CONSTRAINT radar_posts_source_id_fkey
  FOREIGN KEY (source_id) REFERENCES public.radar_sources(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.radar_posts.source_id IS
  'Источник, из которого пришёл пост. Удаление источника уносит его посты (CASCADE); NULL — пост разобран по прямой ссылке.';

-- Сироты и осиротевшие идеи.
WITH orphans AS (
  SELECT r.id, r.project_id
    FROM public.radar_posts r
   WHERE r.source_id IS NULL
     AND r.author_handle IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.radar_sources s
        WHERE s.project_id = r.project_id AND lower(s.handle) = lower(r.author_handle)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.radar_runs rr
        WHERE rr.project_id = r.project_id AND rr.mode = 'url' AND rr.url = r.url
     )
),
ids AS (
  SELECT project_id, array_agg(id) AS post_ids FROM orphans GROUP BY project_id
),
dead_ideas AS (
  DELETE FROM public.idea_bank i
   USING ids
   WHERE i.project_id = ids.project_id
     AND i.content_item_id IS NULL
     AND i.source_post_ids <@ ids.post_ids
     AND array_length(i.source_post_ids, 1) > 0
  RETURNING i.id
)
DELETE FROM public.radar_posts p USING orphans o WHERE p.id = o.id;

-- У выживших идей вычищаем ссылки на удалённые посты.
UPDATE public.idea_bank i
   SET source_post_ids = coalesce(
         (SELECT array_agg(sp) FROM unnest(i.source_post_ids) sp
           WHERE EXISTS (SELECT 1 FROM public.radar_posts p WHERE p.id = sp)),
         '{}'::uuid[])
 WHERE EXISTS (
   SELECT 1 FROM unnest(i.source_post_ids) sp
    WHERE NOT EXISTS (SELECT 1 FROM public.radar_posts p WHERE p.id = sp)
 );
