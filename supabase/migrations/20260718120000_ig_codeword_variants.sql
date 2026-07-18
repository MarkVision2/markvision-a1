-- Instagram codewords: multiple comment replies, DM messages, and target links (random rotation).

ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS comment_replies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dm_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS target_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.instagram_codewords.comment_replies IS
  'Up to 10 comment reply variants; one is picked at random per webhook call.';
COMMENT ON COLUMN public.instagram_codewords.dm_messages IS
  'Up to 10 DM text variants sent together with the link.';
COMMENT ON COLUMN public.instagram_codewords.target_urls IS
  'Up to 10 landing URLs; one is picked at random and encoded in redirect ?v= index.';

-- Backfill target_urls from legacy target_url
UPDATE public.instagram_codewords
   SET target_urls = jsonb_build_array(target_url)
 WHERE target_url IS NOT NULL
   AND target_url <> ''
   AND (target_urls IS NULL OR target_urls = '[]'::jsonb);

-- Allow comment events in organic funnel
ALTER TABLE public.instagram_organic_events
  DROP CONSTRAINT IF EXISTS instagram_organic_events_event_type_check;

ALTER TABLE public.instagram_organic_events
  ADD CONSTRAINT instagram_organic_events_event_type_check
  CHECK (event_type IN ('codeword_dm', 'codeword_comment', 'link_click', 'lead'));

CREATE OR REPLACE VIEW public.instagram_codeword_stats AS
SELECT
  w.id                                                          AS codeword_id,
  w.project_id,
  w.codeword,
  w.short_id,
  w.reel_url,
  w.thumbnail_url,
  w.active,
  COUNT(e.*) FILTER (WHERE e.event_type = 'codeword_dm')         AS codeword_dms,
  COUNT(e.*) FILTER (WHERE e.event_type = 'codeword_comment')    AS codeword_comments,
  COUNT(DISTINCT e.username) FILTER (
    WHERE e.event_type IN ('codeword_dm', 'codeword_comment') AND e.username IS NOT NULL
  )                                                              AS unique_users,
  COUNT(e.*) FILTER (WHERE e.event_type = 'link_click')          AS link_clicks,
  COUNT(e.*) FILTER (WHERE e.event_type = 'lead')                AS leads,
  COUNT(l.id) FILTER (WHERE e.event_type = 'lead' AND l.paid = true)
                                                                AS sales,
  COALESCE(SUM(l.amount) FILTER (WHERE e.event_type = 'lead' AND l.paid = true), 0)
                                                                AS revenue,
  MAX(e.occurred_at)                                             AS last_event_at
FROM public.instagram_codewords w
LEFT JOIN public.instagram_organic_events e ON e.codeword_id = w.id
LEFT JOIN public.leads l ON l.id = e.lead_id
GROUP BY w.id, w.project_id, w.codeword, w.short_id, w.reel_url, w.thumbnail_url, w.active;

COMMENT ON VIEW public.instagram_codeword_stats IS
  'Воронка по код-слову: комментарий/DM → клики → лиды → продажи.';

CREATE OR REPLACE VIEW public.instagram_reel_daily AS
SELECT
  e.project_id,
  e.codeword_id,
  e.codeword,
  e.date,
  COUNT(*) FILTER (WHERE e.event_type = 'codeword_dm')       AS codeword_dms,
  COUNT(*) FILTER (WHERE e.event_type = 'codeword_comment')  AS codeword_comments,
  COUNT(*) FILTER (WHERE e.event_type = 'link_click')        AS link_clicks,
  COUNT(*) FILTER (WHERE e.event_type = 'lead')              AS leads
FROM public.instagram_organic_events e
WHERE e.project_id IS NOT NULL
  AND e.codeword_id IS NOT NULL
GROUP BY e.project_id, e.codeword_id, e.codeword, e.date;

ALTER VIEW public.instagram_codeword_stats SET (security_invoker = true);
ALTER VIEW public.instagram_reel_daily SET (security_invoker = true);
