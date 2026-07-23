-- Прод: фильтр ботов в кликах код-слов (если db push недоступен — SQL Editor).
DROP VIEW IF EXISTS public.instagram_codeword_stats;
CREATE VIEW public.instagram_codeword_stats AS
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
  COUNT(e.*) FILTER (
    WHERE e.event_type = 'link_click'
      AND coalesce(e.payload->>'user_agent', '') NOT ILIKE '%facebookexternalhit%'
      AND coalesce(e.payload->>'user_agent', '')
        !~* '(bot|crawler|spider|preview|facebookcatalog|whatsapp|telegram|slack|discord|vkshare|skypeuripreview)'
  )                                                              AS link_clicks,
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

ALTER VIEW public.instagram_codeword_stats SET (security_invoker = true);
