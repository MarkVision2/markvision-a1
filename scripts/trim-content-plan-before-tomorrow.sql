-- Убрать публикации до завтра (Алматы) из контент-плана.
-- Измерение воронки стартует с завтрашнего дня.
-- Supabase → SQL Editor → Run (проект szfgdruhlebfvcmlvxdk)

DELETE FROM public.content_plan_items
WHERE COALESCE(published_at, scheduled_at, created_at)
  < ((timezone('Asia/Almaty', now()))::date + 1)::timestamptz;
