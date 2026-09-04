-- Bucket для роликов, которые оператор заливает с компьютера в разделе
-- «Публикации» → «Залить видео». Крупные файлы (>45 МБ) идут мимо Storage
-- напрямую в R2 (r2-presign-upload), сюда попадает только мелочь.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('publish-uploads', 'publish-uploads', true, null,
        array['video/mp4','video/quicktime','video/x-m4v'])
on conflict (id) do nothing;

-- Политики в стиле montage-uploads: заливка из приложения, чтение публичное
-- (площадки скачивают файл по прямой ссылке без наших заголовков).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'publish-uploads insert') then
    create policy "publish-uploads insert" on storage.objects
      for insert to anon, authenticated with check (bucket_id = 'publish-uploads');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'publish-uploads update') then
    create policy "publish-uploads update" on storage.objects
      for update to anon, authenticated using (bucket_id = 'publish-uploads');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'publish-uploads delete') then
    create policy "publish-uploads delete" on storage.objects
      for delete to anon, authenticated using (bucket_id = 'publish-uploads');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'publish-uploads read') then
    create policy "publish-uploads read" on storage.objects
      for select using (bucket_id = 'publish-uploads');
  end if;
end $$;
