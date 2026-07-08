# Как выкатить обновления

Код: **MarkVision2/markvision-a1**, ветка **main**.  
Репозиторий: https://github.com/MarkVision2/markvision-a1

## Два сайта — один GitHub, разные сборки

```
git push origin main
        │
        ├─► Vercel (markvision-ai-s-projects) ──► www.markvision.kz   ← ОСНОВНОЙ ДОМЕН
        │
        └─► Lovable Git sync ──► markvision-a1.lovable.app          ← превью (отстаёт на 2–10 мин)
```

**Lovable НЕ деплоит на markvision.kz.** Домен обновляется только из GitHub → Vercel.  
Кнопка **Publish** в редакторе Lovable не обязательна, если Git подключён.

## Чеклист после push в main

1. GitHub `main` — последний коммит (не `[lovable-stamp]`).
2. **www.markvision.kz/lovable-sync.json** — тот же `git_sha`, что в GitHub.
3. Lovable → **Settings → Git** — Connected, ветка `main`, подождать синк.
4. **Settings → Environment** — Supabase **szfg** (как ниже), иначе в редакторе другие цифры, чем на домене.
5. `Cmd+Shift+R` на https://www.markvision.kz

Проверка версии в приложении: **Настройки → Обновления**.

## Publish в Lovable

Если Git Connected — Publish не нужен для домена. Если синк завис:

- Сохраните или отмените несохранённые правки в редакторе
- Settings → Git → Pull / Sync from GitHub
- Подождите 5–10 минут

## Supabase (не Lovable)

Единый прод-проект: **szfgdruhlebfvcmlvxdk** (CRM, метрики, Meta, контент-завод).

Edge Functions деплоятся на **szfg**:

```bash
./scripts/migrate-to-szfg/05-deploy-functions.sh
```

Или GitHub → Actions → **Deploy Meta edge functions** / **Supabase deploy**.

Секреты GitHub: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` = `szfgdruhlebfvcmlvxdk`.

Env в Lovable (**Settings → Environment**) — опционально, если нужно переопределить проект.
По умолчанию прод уже зашит в **`.env.production`** и `src/lib/supabaseConfig.ts` (szfg):

```env
VITE_SUPABASE_PROJECT_ID=szfgdruhlebfvcmlvxdk
VITE_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-

VITE_CLIENT_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_uOw4GUu0skHaB7F7LZ8tlQ_Fq0hrwe-
```

После push в `main` Lovable пересоберёт фронт с этими значениями — вручную в UI вставлять не обязательно.
