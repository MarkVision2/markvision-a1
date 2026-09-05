-- Метрики публикаций: пост, которого для нашего токена больше нет (удалён,
-- опубликован под другим пользователем, нет прав на insights), не должен
-- опрашиваться каждый прогон publish-metrics по всем трём контрольным точкам —
-- это сжигает бюджет времени функции и лимиты Graph API. Едж-функция ставит на
-- задание причину, выборка post_metrics_due такие задания пропускает, а
-- переподключение аккаунта (publish-oauth) причину снимает — метрики пробуют
-- собрать снова уже новым токеном.
ALTER TABLE public.publish_jobs
  ADD COLUMN IF NOT EXISTS metrics_unavailable_reason text;

COMMENT ON COLUMN public.publish_jobs.metrics_unavailable_reason IS
  'Почему метрики поста не собрать (ответ площадки); NULL — собирать по расписанию. Снимается при reconnect аккаунта.';

CREATE OR REPLACE FUNCTION public.post_metrics_due(p_limit integer DEFAULT 200)
RETURNS TABLE (job_id uuid, project_id uuid, account_id uuid, platform text, external_post_id text, checkpoint text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id, j.project_id, j.account_id, j.platform, j.external_post_id, cp.checkpoint
    FROM public.publish_jobs j
    CROSS JOIN (VALUES ('d1', interval '1 day'), ('d3', interval '3 days'), ('d7', interval '7 days')) AS cp(checkpoint, age)
   WHERE j.status = 'published'
     AND j.external_post_id IS NOT NULL
     AND j.metrics_unavailable_reason IS NULL
     AND j.published_at <= now() - cp.age
     AND j.published_at >= now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.post_metrics m WHERE m.job_id = j.id AND m.checkpoint = cp.checkpoint)
   ORDER BY j.published_at
   LIMIT greatest(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.post_metrics_due(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_metrics_due(integer) TO service_role;
