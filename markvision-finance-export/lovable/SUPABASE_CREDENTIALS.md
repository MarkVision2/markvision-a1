# Supabase для Lovable

При создании проекта Lovable спросит подключить Supabase. Вставь:

| Поле | Значение |
|------|----------|
| Project URL | `https://zcsxzgigtsdoebtginfy.supabase.co` |
| Project ID  | `zcsxzgigtsdoebtginfy` |
| Anon / Publishable key | `sb_publishable_APrHSeFW7G1qle2C6c9EuQ_rPq0fsoX` |

Это публичный ключ — безопасно держать во фронте, RLS защищает данные.

## Что НЕ давать Lovable

`service_role` ключ — никогда. Только для n8n и серверных интеграций. Получить можно в Supabase Dashboard → Settings → API.

## Включить Email Auth

В Supabase Dashboard → Authentication → Providers → **Email** → включить, на старте можно отключить confirmation email (Settings → Auth → «Confirm email» = off, чтобы быстро войти).

После первого логина в Lovable приложении:
1. Узнай свой `auth.users.id` — Dashboard → Authentication → Users → копируешь UUID
2. В Settings приложения добавь свой Telegram chat_id → создастся строка в `telegram_users` → n8n начнёт принимать твои сообщения.
