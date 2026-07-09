-- Отправка личных сообщений через Page-linked (Facebook Login for Business)
-- токен стабильно падает с "(#3) Application does not have the capability to
-- make this API call", хотя instagram_manage_messages есть в правах и
-- тестировщик подтверждён — судя по всему, у приложения в Meta App Dashboard
-- реально настроен продукт "Instagram API with Instagram Login" (там же есть
-- отдельная генерация токена под тот же аккаунт), а не полноценная
-- Facebook-Login-for-Business связка для сообщений. Добавляем отдельный
-- токен именно для отправки DM (Instagram Login, graph.instagram.com),
-- публичный ответ на комментарий продолжает идти через уже рабочий
-- Page-токен.
alter table instagram_accounts add column if not exists ig_login_access_token text;

alter table instagram_accounts add column if not exists ig_login_token_present boolean
  generated always as (ig_login_access_token is not null and length(ig_login_access_token) > 0) stored;

drop view if exists instagram_accounts_safe;

create view instagram_accounts_safe as
select
  id, project_id, ig_user_id, username, name, profile_picture_url, page_id, page_name,
  page_token_present, ig_login_token_present,
  followers_count, follows_count, media_count, active, last_sync_at, last_error, created_at, updated_at
from instagram_accounts;

grant select, insert, update, delete, truncate, references, trigger on instagram_accounts_safe to authenticated, anon, service_role, postgres;
