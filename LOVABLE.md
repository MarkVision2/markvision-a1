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

Единый прод-проект: **szfgdruhlebfvcmlvxdk** (CRM, метрики, Meta, контент-завод).

Edge Functions деплоятся на **szfg**:

```bash
./scripts/migrate-to-szfg/05-deploy-functions.sh
```

Или GitHub → Actions → **Deploy Meta edge functions** / **Supabase deploy**.

Секреты GitHub: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` = `szfgdruhlebfvcmlvxdk`.

Env в Lovable (**Settings → Environment**), затем дождитесь пересборки:

```env
VITE_SUPABASE_PROJECT_ID=szfgdruhlebfvcmlvxdk
VITE_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-

VITE_CLIENT_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-
```

`VITE_CLIENT_*` обязателен для **Контент-центра**, контент-завода и storage. Без него на проде будет ошибка «VITE_CLIENT_SUPABASE_URL не задан».

Проверка после деплоя: **Настройки → Обновления** — коммит совпадает с GitHub `main`; Контент-центр загружает посты (не пустая ошибка env).
