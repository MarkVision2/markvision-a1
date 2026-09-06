-- Витрина publish_metrics: просроченные задания и честный счётчик токенов.
--
-- Пересоздаётся поверх версии из 20260909150000_content_factory_core.sql
-- (там verifying добавили в jobs_processing — здесь это сохранено). Порядок и
-- имена прежних колонок трогать нельзя: CREATE OR REPLACE VIEW разрешает только
-- дописывать новые в конец. Первая попытка ставила jobs_overdue седьмой колонкой
-- и падала на проде: «cannot change name of view column "jobs_processing" to
-- "jobs_overdue" (42P16)».
--
-- 1. jobs_overdue — задания, чей слот прошёл больше 15 минут назад, а они всё
--    ещё ждут. Крон publish-worker ходит раз в минуту, поэтому живая очередь
--    даёт здесь ноль; ненулевое значение означает, что разбор встал (умер крон,
--    кончились попытки, некому забрать) — до этого страница показывала бодрое
--    «В очереди 13» и ничем не выдавала, что оттуда ничего не уедет.
--
-- 2. «Токены истекают» больше не считает TikTok и YouTube.
--
-- У них access-токен короткий по замыслу площадки (TikTok — сутки, YouTube —
-- час), и publish-monitor продлевает его refresh-токеном каждый день сам. Из-за
-- общего условия «token_expires_at < now() + 7 дней» плитка «Здоровье сети» на
-- странице «Публикации» горела жёлтым постоянно, даже когда вся сеть в порядке:
-- один подключённый TikTok навсегда давал «токены истекают у 1». Тот же принцип
-- уже зашит в формулу здоровья — SHORT_LIVED_TOKEN_PLATFORMS в
-- supabase/functions/_lib/publishHealth.ts.
--
-- Настоящая беда этих площадок — провал обновления, а он поднимает
-- status = token_expired и попадает в accounts_token_expired.

CREATE OR REPLACE VIEW public.publish_metrics
WITH (security_invoker = true)
AS
SELECT
  p.id AS project_id,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id) AS accounts_total,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id AND a.status = 'active' AND a.publish_enabled) AS accounts_active,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id AND a.status = 'token_expired') AS accounts_token_expired,
  (SELECT count(*) FROM public.publish_accounts a WHERE a.project_id = p.id AND a.status IN ('limited', 'error')) AS accounts_limited_or_error,
  (SELECT round(avg(a.health_score), 1) FROM public.publish_accounts a WHERE a.project_id = p.id) AS health_avg,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status IN ('pending', 'retry')) AS jobs_queued,
  -- verifying — тоже «в работе» (миграция 20260909150000): пост ушёл, идёт проверка.
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status IN ('processing', 'verifying')) AS jobs_processing,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status = 'published' AND j.published_at >= now() - interval '24 hours') AS published_24h,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status = 'failed' AND j.updated_at >= now() - interval '24 hours') AS failed_24h,
  (SELECT count(*) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status = 'manual_review') AS manual_review,
  (SELECT min(j.scheduled_at) FROM public.publish_jobs j WHERE j.project_id = p.id AND j.status IN ('pending', 'retry') AND j.scheduled_at > now()) AS next_slot_at,
  (SELECT count(*) FROM public.publish_accounts a
    WHERE a.project_id = p.id
      AND a.token_expires_at IS NOT NULL
      AND a.token_expires_at < now() + interval '7 days'
      -- Короткие токены продлеваются монитором ежедневно — это не тревога.
      AND a.platform NOT IN ('tiktok', 'youtube')) AS tokens_expiring_7d,
  (SELECT coalesce(sum(m.reach), 0) FROM public.post_metrics m WHERE m.project_id = p.id AND m.checkpoint = 'd3' AND m.captured_at >= now() - interval '7 days') AS reach_d3_7d,
  (SELECT spent_month_usd FROM public.project_spend(p.id)) AS spent_month_usd,
  coalesce((SELECT s.paused FROM public.publish_project_settings s WHERE s.project_id = p.id), false) AS paused,
  -- Слот прошёл, а задание не тронуто: воркер до него не доходит.
  -- Только в самом конце: CREATE OR REPLACE VIEW умеет дописывать колонки,
  -- но не вставлять их в середину — вставка перед jobs_processing читается
  -- как переименование седьмой колонки и падает с 42P16.
  (SELECT count(*) FROM public.publish_jobs j
    WHERE j.project_id = p.id
      AND j.status IN ('pending', 'retry')
      AND j.scheduled_at < now() - interval '15 minutes'
      AND j.next_attempt_at < now() - interval '15 minutes') AS jobs_overdue
FROM public.projects p;

GRANT SELECT ON public.publish_metrics TO authenticated, service_role;

COMMENT ON VIEW public.publish_metrics IS
  'Сводка контура публикаций по проекту для страницы «Публикации». jobs_overdue — задания, чей слот прошёл 15+ минут назад (признак вставшей очереди). tokens_expiring_7d не учитывает TikTok и YouTube: их короткие токены продлевает publish-monitor.';
