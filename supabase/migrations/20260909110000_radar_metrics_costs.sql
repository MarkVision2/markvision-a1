-- Радар идей: витрина метрик — честный расход и понятные знаменатели.
--
-- Было: `spent_month_usd` считался только по `radar_runs.cost_usd` (сбор), а
-- разбор постов моделью (Whisper + LLM) в плитку не попадал — пользователь
-- видел «$0.00» при реально потраченных центах. Теперь расход берётся из
-- `usage_ledger` (единый журнал трат) и разложен на сбор и разбор, плюс
-- добавлены знаменатели для подписей: сколько всего постов, сколько с
-- посчитанным X-фактором, сколько идей всего.

DROP VIEW IF EXISTS public.radar_metrics;
CREATE VIEW public.radar_metrics
WITH (security_invoker = true)
AS
SELECT
  p.id AS project_id,
  -- источники
  (SELECT count(*) FROM public.radar_sources s WHERE s.project_id = p.id AND s.enabled) AS sources,
  (SELECT count(*) FROM public.radar_sources s WHERE s.project_id = p.id) AS sources_total,
  -- посты
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id) AS posts_total,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.created_at >= now() - interval '7 days') AS posts_7d,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.analysis_status IN ('pending', 'failed')) AS posts_unanalyzed,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id
     AND r.analysis_status = 'done') AS posts_analyzed,
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id AND r.x_factor >= 2) AS posts_viral,
  -- знаменатель «залетевших»: посты, у которых X-фактор вообще посчитан
  (SELECT count(*) FROM public.radar_posts r WHERE r.project_id = p.id AND r.x_factor IS NOT NULL) AS posts_scored,
  -- идеи
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id) AS ideas_total,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'new') AS ideas_new,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'approved') AS ideas_approved,
  (SELECT count(*) FROM public.idea_bank i WHERE i.project_id = p.id AND i.status = 'used') AS ideas_used,
  -- расход радара за текущий месяц: сбор (Apify / ScrapeCreators) и разбор (Whisper + LLM)
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
  -- сборы
  (SELECT max(rr.finished_at) FROM public.radar_runs rr WHERE rr.project_id = p.id AND rr.status = 'done') AS last_run_at,
  (SELECT count(*) FROM public.radar_runs rr WHERE rr.project_id = p.id AND rr.status = 'running') AS runs_active
FROM public.projects p;

COMMENT ON VIEW public.radar_metrics IS
  'Витрина радара для плиток страницы: источники, посты (всего / 7 дней / залетевшие / в очереди), идеи по статусам, расход за месяц из usage_ledger (сбор + разбор), последний сбор.';

GRANT SELECT ON public.radar_metrics TO authenticated;
