# MarkVision

Платформа управления рекламой и аналитики для рекламных агентств:
дашборд кампаний, A/B-тесты, CRM, отчёты, AI-таргетолог.

Стек: React + Vite + TypeScript + Tailwind + Supabase + n8n.

## Структура репозитория

```
src/                          — фронтенд MarkVision (Vite SPA)
supabase/                     — миграции и edge functions (deploy через CI)
tests/                        — unit + e2e (vitest + playwright)
scripts/                      — служебные скрипты
.github/workflows/            — CI (typecheck + tests + lint),
                                Supabase auto-deploy
```

> **Personal Finance Hub** — отдельный продукт, живёт в своём репозитории
> (Lovable.dev → подключён к собственному GitHub-репо). Этот репозиторий
> к нему отношения не имеет. БД у Finance Hub своя
> (`lsgwjiwzaillykuqegxb`), n8n workflows крутятся на `n8n.zapoinov.com`.

## Supabase-проекты

| Назначение | Ref | Используется в |
|------------|-----|----------------|
| Основная БД MarkVision | `mekwfbqmsqiborjdrjxc` | `src/integrations/supabase/client.ts` |
| Клиентский портал | `szfgdruhlebfvcmlvxdk` | `src/integrations/clientConfig/client.ts` |

## Запуск локально

```bash
npm install
cp .env.example .env   # заполни VITE_SUPABASE_*
npm run dev
```

`.env` гитнорится — секреты не комитим. Шаблоны в `.env.example` и
`.env.local.example`.

## CI

Каждый push/PR гонит:
- `tsc --noEmit` — типы
- `vitest run` — юнит-тесты
- `eslint` — линтер (report-only пока, пока чистим warnings)

См. `.github/workflows/ci.yml`.

Изменения в `supabase/**` дополнительно автодеплоятся через
`.github/workflows/supabase-deploy.yml`.
