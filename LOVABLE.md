# Как выкатить обновления (без Publish)

Код: **MarkVision2/markvision-a1**, ветка **main**.

## Publish в Lovable может отсутствовать — это нормально

Если в Lovable подключён **GitHub**, фронт выкатывается **автоматически** из `main`. Кнопки Publish / Update может не быть.

## Что делать

1. Смержите PR / push в **main** на GitHub.
2. Lovable → **Project settings → Git** — Connected, ветка `main`. Подождите 2–5 минут.
3. Откройте https://markvision-a1.lovable.app/ → **Ctrl+Shift+R**.
4. В приложении: **Настройки → Обновления** — сверьте коммит с GitHub `main`.

## Supabase (не Lovable)

Edge Functions и секреты — проект **mekwfbqmsqiborjdrjxc**.

GitHub → Actions → **Deploy Meta edge functions** → Run workflow.

Секреты: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` = `mekwfbqmsqiborjdrjxc`.
