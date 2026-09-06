-- Радар идей: удаление источника уносит его данные, плюс сводка получает
-- рекорд X-фактора и топ-нишу.
--
-- Было: `radar_posts.source_id` с `ON DELETE SET NULL` — после удаления
-- конкурента его посты оставались в ленте «Тренды» уже без источника, а идеи
-- из них продолжали висеть в банке. Теперь удаление источника чистит за собой:
--   * посты источника удаляются;
--   * идеи, у которых не осталось ни одного исходного поста, удаляются —
--     кроме тех, что уже стали темами контент-плана (их трогать нельзя);
--   * у остальных идей ссылки на удалённые посты вычищаются из массива.
-- Файлы превью в bucket radar-thumbs удаляет edge-функция (Storage не доступен
-- из SQL), поэтому RPC возвращает список постов для очистки.

CREATE OR REPLACE FUNCTION public.radar_delete_source(p_source_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
  v_post_ids uuid[];
  v_posts integer := 0;
  v_ideas integer := 0;
  v_kept integer := 0;
BEGIN
  SELECT project_id INTO v_project FROM public.radar_sources WHERE id = p_source_id;
  IF v_project IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'source not found');
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_post_ids
    FROM public.radar_posts WHERE source_id = p_source_id;

  -- Идеи, целиком построенные на удаляемых постах: те, что уже ушли в
  -- контент-план, оставляем (работа по ним могла начаться) и только
  -- отвязываем от постов.
  WITH affected AS (
    SELECT i.id, i.content_item_id,
           (SELECT count(*) FROM unnest(i.source_post_ids) sp WHERE sp <> ALL (v_post_ids)) AS other_posts
      FROM public.idea_bank i
     WHERE i.project_id = v_project
       AND i.source_post_ids && v_post_ids
  ),
  removed AS (
    DELETE FROM public.idea_bank i
     USING affected a
     WHERE i.id = a.id AND a.other_posts = 0 AND a.content_item_id IS NULL
    RETURNING i.id
  )
  SELECT count(*) INTO v_ideas FROM removed;

  -- У выживших идей чистим ссылки на удалённые посты.
  UPDATE public.idea_bank i
     SET source_post_ids = coalesce(
           (SELECT array_agg(sp) FROM unnest(i.source_post_ids) sp WHERE sp <> ALL (v_post_ids)),
           '{}'::uuid[])
   WHERE i.project_id = v_project
     AND i.source_post_ids && v_post_ids;
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  DELETE FROM public.radar_posts WHERE source_id = p_source_id;
  GET DIAGNOSTICS v_posts = ROW_COUNT;

  DELETE FROM public.radar_sources WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', v_project,
    'posts', v_posts,
    'ideas', v_ideas,
    'ideas_kept', v_kept,
    'post_ids', to_jsonb(v_post_ids)
  );
END;
$$;

COMMENT ON FUNCTION public.radar_delete_source(uuid) IS
  'Удаляет источник вместе с его постами и осиротевшими идеями; идеи, ставшие темами контент-плана, остаются. Возвращает счётчики и id постов для очистки превью в Storage.';

REVOKE ALL ON FUNCTION public.radar_delete_source(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_delete_source(uuid) TO service_role;

-- Сколько данных уйдёт вместе с источником — показываем в подтверждении.
CREATE OR REPLACE FUNCTION public.radar_source_impact(p_source_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT coalesce(array_agg(id), '{}') AS post_ids FROM public.radar_posts WHERE source_id = p_source_id
  )
  SELECT jsonb_build_object(
    'posts', (SELECT array_length(post_ids, 1) FROM ids),
    'ideas', (SELECT count(*) FROM public.idea_bank i, ids
               WHERE i.source_post_ids && ids.post_ids AND i.content_item_id IS NULL)
  );
$$;

REVOKE ALL ON FUNCTION public.radar_source_impact(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_source_impact(uuid) TO service_role;

-- ── Сводка: рекорд X-фактора и самая частая ниша ────────────────────────
DROP VIEW IF EXISTS public.radar_metrics;
CREATE VIEW public.radar_metrics
WITH (security_invoker = true)
AS
SELECT
  p.id AS project_id,
  (SELECT count(*) FROM public.radar_sources s WHERE s.project_id = p.id AND s.enabled) AS sources,
  (SELECT count(*) FROM public.radar_sources s WHERE s.project_id = p.id) AS sources_total,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id) AS posts_total,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.created_at >= now() - interval '7 days') AS posts_7d,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.created_at >= date_trunc('day', now())) AS posts_today,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.analysis_status IN ('pending', 'failed')) AS posts_unanalyzed,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.analysis_status = 'done') AS posts_analyzed,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id AND r.x_factor >= 2) AS posts_viral,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id AND r.x_factor IS NOT NULL) AS posts_scored,
  -- рекорд: самый «залетевший» пост проекта и его автор
  (SELECT r.x_factor FROM public.radar_posts r WHERE r.project_id = p.id
    ORDER BY r.x_factor DESC NULLS LAST LIMIT 1) AS best_x_factor,
  (SELECT r.author_handle FROM public.radar_posts r WHERE r.project_id = p.id
    ORDER BY r.x_factor DESC NULLS LAST LIMIT 1) AS best_x_author,
  -- ниша, которая чаще всего встречается в разборах залетевших постов
  (SELECT r.analysis->>'niche' FROM public.radar_posts r
    WHERE r.project_id = p.id AND r.analysis->>'niche' IS NOT NULL AND btrim(r.analysis->>'niche') <> ''
    GROUP BY r.analysis->>'niche'
    ORDER BY count(*) DESC, max(r.score) DESC NULLS LAST
    LIMIT 1) AS top_niche,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id) AS ideas_total,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'new') AS ideas_new,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'approved') AS ideas_approved,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'used') AS ideas_used,
  (SELECT coalesce(sum(u.cost_usd), 0) FROM public.usage_ledger u
    WHERE u.project_id = p.id AND u.note LIKE 'radar%'
      AND u.engine IN ('apify', 'scrapecreators')
      AND u.created_at >= date_trunc('month', now())) AS spent_month_crawl_usd,
  (SELECT coalesce(sum(u.cost_usd), 0) FROM public.usage_ledger u
    WHERE u.project_id = p.id AND u.note LIKE 'radar%'
      AND u.engine NOT IN ('apify', 'scrapecreators')
      AND u.created_at >= date_trunc('month', now())) AS spent_month_ai_usd,
  (SELECT coalesce(sum(u.cost_usd), 0) FROM public.usage_ledger u
    WHERE u.project_id = p.id AND u.note LIKE 'radar%'
      AND u.created_at >= date_trunc('month', now())) AS spent_month_usd,
  (SELECT max(rr.finished_at) FROM public.radar_runs rr WHERE rr.project_id = p.id AND rr.status = 'done') AS last_run_at,
  (SELECT count(*) FROM public.radar_runs rr WHERE rr.project_id = p.id AND rr.status = 'running') AS runs_active
FROM public.projects p;

GRANT SELECT ON public.radar_metrics TO authenticated;
