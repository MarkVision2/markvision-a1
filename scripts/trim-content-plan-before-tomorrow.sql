-- Убрать публикации до завтра (Алматы) из контент-плана.
-- Измерение воронки стартует с завтрашнего дня.
-- Supabase → SQL Editor → Run (проект szfgdruhlebfvcmlvxdk)

WITH cutoff AS (
  SELECT ((timezone('Asia/Almaty', now()))::date + 1)
    ::timestamp AT TIME ZONE AT TIME ZONE 'Asia/Almaty' AS ts
)
DELETE FROM public.content_plan_items c
USING cutoff
WHERE COALESCE(c.published_at, c.scheduled_at, c.created_at) < cutoff.ts;
