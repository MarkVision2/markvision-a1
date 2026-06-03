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
