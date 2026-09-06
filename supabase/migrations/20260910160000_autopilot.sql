-- Social Content Factory OS, Phase 5: автопилот победителей и метаданные контента.
--
--   1. publish_videos.hook_type / cta_type / source_video_id — чем ролик цепляет, к чему зовёт,
--      из какого ролика сделан (варианты победителя); topic_key уже есть.
--   2. publish_publications — те же поля в витрине (инсайты по хукам и темам).
--   3. publish_replications — журнал автоповтора: победитель × группа → дочерняя тема конвейера.
--   4. Крон publish-monitor mode=winner_replication раз в сутки (только проекты с флагом
--      features.winner_replication_enabled).
--
-- Идемпотентна. Ничего не удаляет.

-- ── 1. метаданные контента ───────────────────────────────────
ALTER TABLE public.publish_videos
  ADD COLUMN IF NOT EXISTS hook_type       text,
  ADD COLUMN IF NOT EXISTS cta_type        text,
  ADD COLUMN IF NOT EXISTS source_video_id uuid REFERENCES public.publish_videos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.publish_videos.hook_type IS 'Тип хука (первые секунды): вопрос, боль, цифра, шок, история… — свободный ключ для аналитики.';
COMMENT ON COLUMN public.publish_videos.cta_type IS 'Тип призыва: запись, подписка, комментарий, директ… — свободный ключ для аналитики.';
COMMENT ON COLUMN public.publish_videos.source_video_id IS 'Ролик-источник (варианты победителя, ремейки) — родословная контента.';

CREATE INDEX IF NOT EXISTS publish_videos_source_idx ON public.publish_videos (source_video_id) WHERE source_video_id IS NOT NULL;

-- ── 2. витрина публикаций: + topic_key, hook_type, cta_type (в конец списка) ──
CREATE OR REPLACE VIEW public.publish_publications
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (m.job_id) m.job_id, m.checkpoint, m.captured_at, m.reach, m.views, m.likes, m.comments, m.shares, m.saves, m.followers
    FROM public.post_metrics m
   ORDER BY m.job_id,
            CASE m.checkpoint WHEN 'd7' THEN 6 WHEN 'd3' THEN 5 WHEN 'd1' THEN 4 WHEN 'h6' THEN 3 WHEN 'h1' THEN 2 ELSE 1 END DESC,
            m.captured_at DESC
)
SELECT
  j.id                    AS publication_id,
  j.project_id,
  j.video_id              AS content_id,
  j.account_id,
  j.platform,
  j.status,
  j.verification_status,
  j.verified_at,
  j.external_post_id      AS platform_media_id,
  j.external_post_url     AS platform_url,
  j.scheduled_at,
  j.published_at,
  j.caption,
  j.hashtags,
  j.error_class,
  j.error_code,
  j.trace_id,
  a.account_name,
  a.handle,
  v.title                 AS content_title,
  l.checkpoint            AS metrics_checkpoint,
  l.captured_at           AS metrics_captured_at,
  l.views, l.reach, l.likes, l.comments, l.shares, l.saves,
  CASE WHEN l.job_id IS NULL THEN NULL
       ELSE public.publish_performance_score(l.views, l.reach, l.likes, l.comments, l.shares, l.saves, coalesce(l.followers, a.followers)) END AS score,
  v.topic_key,
  v.hook_type,
  v.cta_type
FROM public.publish_jobs j
JOIN public.publish_accounts a ON a.id = j.account_id
JOIN public.publish_videos v ON v.id = j.video_id
LEFT JOIN latest l ON l.job_id = j.id
WHERE j.status IN ('verifying', 'published');

-- ── 3. журнал автоповтора ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.publish_replications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content_id    uuid NOT NULL REFERENCES public.publish_videos(id) ON DELETE CASCADE,
  item_id       uuid REFERENCES public.content_plan_items(id) ON DELETE SET NULL,
  group_id      uuid NOT NULL REFERENCES public.publish_account_groups(id) ON DELETE CASCADE,
  child_item_id uuid REFERENCES public.content_plan_items(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'created',
  reason        text,
  created_by    text NOT NULL DEFAULT 'autopilot',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publish_replications_status_check CHECK (status IN ('created', 'skipped', 'failed')),
  CONSTRAINT publish_replications_uniq UNIQUE (content_id, group_id)
);
COMMENT ON TABLE public.publish_replications IS
  'Автопилот победителей: для ролика-победителя и группы аккаунтов создана дочерняя тема конвейера (child_item_id) или отмечено, почему нет.';
CREATE INDEX IF NOT EXISTS publish_replications_project_idx ON public.publish_replications (project_id, created_at DESC);

ALTER TABLE public.publish_replications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publish_replications_select ON public.publish_replications;
CREATE POLICY publish_replications_select ON public.publish_replications FOR SELECT TO authenticated
  USING (public.user_can_access_project(project_id));
GRANT SELECT ON public.publish_replications TO authenticated;

-- ── 4. крон: автоповтор раз в сутки, после снятия метрик ─────
SELECT cron.unschedule('publish-monitor-winner-replication-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-monitor-winner-replication-daily');
SELECT cron.schedule(
  'publish-monitor-winner-replication-daily',
  '50 6 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://szfgdruhlebfvcmlvxdk.supabase.co/functions/v1/publish-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-key', (SELECT cron_secret FROM public.automation_settings WHERE id = true)
    ),
    body    := jsonb_build_object('mode', 'winner_replication')
  );
  $$
);
