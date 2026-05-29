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
markvision-finance-export/    — снапшот *отдельного* продукта MarkVision Finance
                                (Telegram-бот → n8n → Supabase).
                                Целевой репозиторий: markvision-ai/markvision-finance
.github/workflows/            — CI (typecheck + tests + lint),
                                Supabase auto-deploy
```

## Supabase-проекты

| Назначение | URL/Ref | Используется в |
|------------|---------|----------------|
| Основная БД MarkVision | `mekwfbqmsqiborjdrjxc` | `src/integrations/supabase/client.ts` |
| Клиентский портал | `szfgdruhlebfvcmlvxdk` | `src/integrations/clientConfig/client.ts` |
| MarkVision Finance (бот) | `lsgwjiwzaillykuqegxb` | `markvision-finance-export/` + n8n |

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
