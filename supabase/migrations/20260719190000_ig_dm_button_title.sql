-- Текст кнопки CTA в Instagram Direct (button template).
ALTER TABLE public.instagram_codewords
  ADD COLUMN IF NOT EXISTS dm_button_title text;

COMMENT ON COLUMN public.instagram_codewords.dm_button_title IS
  'Подпись кнопки web_url в private reply (до 20 символов). Пусто = «Зарегистрироваться».';
