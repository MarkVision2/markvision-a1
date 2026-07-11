-- Публичный бакет для постоянного хранения видео-креативов.
-- fbcdn video source истекает и режется по Referer в браузере, поэтому
-- meta-creative-refresh скачивает mp4 один раз и кладёт сюда (как постеры).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creative-videos', 'creative-videos', true, 209715200, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = true, file_size_limit = 209715200;
