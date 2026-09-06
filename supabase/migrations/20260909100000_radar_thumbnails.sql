-- Радар идей: собственное хранилище превью постов.
--
-- Сборщики отдают ссылки на CDN площадок (scontent.cdninstagram.com и т.п.):
-- они подписаны и живут дни, а из браузера с чужим referrer часто отдают 403 —
-- в ленте трендов вместо превью были битые картинки. Edge-функция radar
-- после сбора копирует картинку в bucket radar-thumbs и переписывает
-- radar_posts.thumbnail_url на постоянную публичную ссылку; исходная остаётся в raw.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('radar-thumbs', 'radar-thumbs', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Пишет только edge-функция сервисной ролью (RLS её не касается); чтение — публичное.
drop policy if exists "radar-thumbs read" on storage.objects;
create policy "radar-thumbs read" on storage.objects
  for select using (bucket_id = 'radar-thumbs');
