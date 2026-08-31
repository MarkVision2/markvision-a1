-- Карточка клиента: компания отдельно от контактного лица.
--
-- Раньше название компании, ФИО контакта и суть запроса приходилось писать
-- в одно поле «имя лида», в скобках. Разносим по отдельным колонкам.
--
-- «Комментарий по итогам разговора» уже есть — это существующая колонка note.
--
-- ADD COLUMN IF NOT EXISTS: миграция идемпотентна, повторный прогон безопасен.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS client_request text;

COMMENT ON COLUMN public.leads.company_name IS 'Название компании клиента';
COMMENT ON COLUMN public.leads.contact_person IS 'ФИО контактного лица в компании';
COMMENT ON COLUMN public.leads.industry IS 'Сфера деятельности компании';
COMMENT ON COLUMN public.leads.client_request IS 'С чем клиент обратился';
