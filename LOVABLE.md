# Как выкатить обновления в Lovable

Код лежит в GitHub: **MarkVision2/markvision-a1**, ветка **main**.

Cursor/агент **не может** нажать Publish в Lovable за вас — это кнопка платформы.

## Быстрый чеклист

1. Откройте проект: https://lovable.dev/projects/f271a37b-306d-4edb-aaa5-782c76cf9ae3  
2. **Project settings → Git → GitHub** — Connected, ветка **main**.  
3. Дождитесь синхронизации с GitHub (минуты).  
4. **Publish** (правый верхний угол) → **Update**, если уже публиковали.  
5. Живой сайт: https://markvision-a1.lovable.app/ — Ctrl+Shift+R.

## Проверка версии

В приложении: **Настройки → Обновления** — показывается `lovable-sync.json` (коммит и дата).

## Supabase (Meta, CRM)

Publish выкладывает только фронт. Edge Functions и секреты — в Supabase проекта **mekwfbqmsqiborjdrjxc**.

### HQ-превью креативов (после мержа PR с fix)

1. GitHub → **Actions** → **Deploy Meta edge functions** → **Run workflow** (ветка `main`).
2. Нужны секреты репозитория: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` = `mekwfbqmsqiborjdrjxc`.
3. В Supabase → Edge Functions → Secrets должен быть `META_ACCESS_TOKEN` (тот же, что для Meta-синка).
4. Откройте дашборд или запустите `meta-structure-sync` — постеры подтянутся в Storage (`creative-posters`).

Альтернатива без Actions (локально):

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
supabase functions deploy meta-creative-refresh --project-ref mekwfbqmsqiborjdrjxc
supabase functions deploy meta-structure-sync --project-ref mekwfbqmsqiborjdrjxc
supabase functions deploy meta-poster-upload --project-ref mekwfbqmsqiborjdrjxc
```
