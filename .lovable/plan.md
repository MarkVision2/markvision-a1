# Онбординг нового проекта

## Что делаем

Сейчас при «Добавить проект» открывается мини-диалог с двумя полями (название + домен) и проект создаётся пустым. Заменим его на полноценный онбординг-визард, который за 4 шага собирает всё нужное: бриф по нише, рекламный кабинет и сразу генерирует AI-описание для будущей рекламы. Все данные привязываются к новому `project_id`.

## Поток пользователя

```
[Plus "Добавить проект"]
   ↓
Step 1 — Проект           (название, город, домен сайта)
Step 2 — Ниша и бриф      (ниша, ЦА, продукт, УТП, гео, бюджет/мес)
Step 3 — Рекламный кабинет (можно пропустить и добавить позже)
              • тип (Личный/Бизнес/Агентский)
              • Ad Account ID, Page ID, Pixel ID, IG ID
              • Access Token, WhatsApp, сайт + событие пикселя
Step 4 — Готово
              • AI пишет project_brief.md (короткий бриф)
              • AI генерирует 3 варианта primary_text + headline + CTA
              • показываем результат → "Перейти в проект"
```

Кнопка «Пропустить» доступна на шагах 2 и 3 — проект всё равно создаётся, бриф можно дописать позже в Настройках проекта.

## Где хранить данные

Добавляем новую таблицу `project_briefs` (1-к-1 с проектом) — отдельно от `projects`, чтобы не раздувать основную таблицу и легко расширять:

```
project_briefs
  project_id     uuid PK → projects.id (cascade)
  niche          text         — "стоматология", "автосервис", ...
  audience       text         — портрет ЦА
  product        text         — что продаём
  usp            text         — УТП / отстройка
  geo            text         — города/регионы
  monthly_budget numeric      — ориентир по бюджету
  tone           text         — тон коммуникации
  brief_md       text         — сгенерированный AI бриф (markdown)
  ai_primary_text text        — выбранный AI-вариант текста рекламы
  ai_headline    text
  ai_cta         text
  ai_variants    jsonb        — все 3 сгенерированных варианта
  created_at / updated_at
```

RLS: SELECT всем authenticated, write — admin (как `ad_cabinets`).

Кабинет на шаге 3 создаётся в существующей `ad_cabinets` с уже заполненным `project_id` — никаких новых полей не нужно, всё уже есть (`access_token`, `ad_account_id`, `page_id`, `pixel_id`, `whatsapp_number`, `website_url`, `pixel_event` и т.д.).

После онбординга в `user_active_project` сразу ставится новый проект — пользователь оказывается «внутри» него.

## AI-генерация

Используем существующий Lovable AI (`google/gemini-2.5-flash`, без API-ключей) через новую edge-функцию `generate-project-brief`:

**Вход:** `{ projectId, niche, audience, product, usp, geo, tone, city, websiteUrl }`

**Что делает:**
1. Системный промпт: «Ты маркетолог. На основе данных составь краткий бриф (markdown, до 1500 символов) и 3 варианта рекламного креатива для Meta Ads».
2. Запрашиваем JSON: `{ brief_md, variants: [{ primary_text, headline, cta }, ...] }`.
3. Сохраняем в `project_briefs` (`brief_md`, `ai_variants`, и первый вариант — в `ai_primary_text/headline/cta`).
4. Возвращаем результат фронту.

Бриф потом используется в `CreateStep3` (генерация контента/рекламы) как контекст по умолчанию — чтобы тексты сразу писались «в нишу».

## UI

Новый компонент `src/components/projects/ProjectOnboardingDialog.tsx` — степпер с прогресс-баром (1/4 → 4/4), валидация zod, кнопки «Назад / Пропустить / Далее». На шаге 4 — лоадер «AI пишет бриф…», затем превью брифа и 3 карточки с вариантами текста (можно выбрать один как «основной»).

В `ProjectSwitcher.tsx` заменяем текущий маленький Dialog вызовом `ProjectOnboardingDialog`.

В `Settings` добавим вкладку «Бриф проекта» (read+edit), чтобы можно было дописать/перегенерировать позже.

## Изменения по файлам

**Создать:**
- `supabase/migrations/...` — таблица `project_briefs` + RLS
- `supabase/functions/generate-project-brief/index.ts` — AI-генерация (Lovable AI)
- `src/components/projects/ProjectOnboardingDialog.tsx` — визард
- `src/components/projects/steps/Step1Project.tsx`
- `src/components/projects/steps/Step2Brief.tsx`
- `src/components/projects/steps/Step3Cabinet.tsx`
- `src/components/projects/steps/Step4Result.tsx`
- `src/hooks/useProjectBrief.ts` — CRUD + вызов edge-функции

**Изменить:**
- `src/hooks/useProjectsStore.ts` — `addProject` принимает расширенный объект и возвращает `project.id` (уже возвращает); сразу делает `setActive`
- `src/components/layout/ProjectSwitcher.tsx` — заменить inline-Dialog на `<ProjectOnboardingDialog />`
- `src/hooks/useCabinetsStore.ts` — добавить `addCabinet(projectId, data)` если ещё нет
- `src/pages/CreateStep3.tsx` — при формировании промпта подмешивать `brief_md` активного проекта (чтобы тексты были «в нишу»)
- `src/pages/Settings.tsx` — вкладка «Бриф проекта»

## Важные детали

- На шаге 3 «Пропустить» допустимо — проект создаётся без кабинета, AI-бриф всё равно генерируется (по нише и продукту).
- AI-генерация запускается асинхронно после создания проекта — фронт не ждёт ответа дольше 15с, при таймауте сохраняем «черновик» брифа и даём кнопку «Перегенерировать».
- Все шаги пишут промежуточно: проект создаётся в конце Step 1, кабинет — в конце Step 3. Это значит, что закрыв окно посередине, пользователь не теряет уже созданный проект.
- `ai_variants` хранится как `jsonb` — можно легко добавить «выбрать другой вариант» позже.
- Бриф потом дёргается в рекламе и в контент-фабрике — единый источник правды по нише.
