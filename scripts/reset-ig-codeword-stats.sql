-- One-shot: обнулить тестовую статистику по код-словам и кликам кнопки.
-- Не трогает код-слова (instagram_codewords) и не удаляет заявки из CRM (leads).
-- Удаляет только события воронки в instagram_organic_events.

DELETE FROM public.instagram_organic_events
WHERE event_type IN (
  'codeword_comment',
  'codeword_dm',
  'link_click',
  'lead'
);
