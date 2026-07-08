-- Проект на Free-плане Supabase: платформа жёстко ограничивает загрузку в Storage
-- 50 МБ на файл вне зависимости от bucket-level file_size_limit ("The object
-- exceeded the maximum allowed size"). Бакет autopost был выставлен на 200 МБ —
-- это значение никогда реально не работало, приводя к путающей ошибке при
-- загрузке видео 50–200 МБ. Приводим лимит бакета в соответствие с реальным
-- потолком платформы, чтобы поведение было предсказуемым.
update storage.buckets
set file_size_limit = 52428800 -- 50 MB
where id = 'autopost';
