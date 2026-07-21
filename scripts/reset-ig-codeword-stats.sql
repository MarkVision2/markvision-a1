-- One-shot: обнулить тестовую статистику по код-словам / кликам / legacy CF.
-- Не трогает: код-слова (instagram_codewords), медиа, CRM leads, контент-план.
-- Чистит только события воронки и старые cf_* attribution-таблицы.

DELETE FROM public.instagram_organic_events;

DELETE FROM public.cf_clicks;

DELETE FROM public.cf_leads;

DELETE FROM public.cf_payments;
