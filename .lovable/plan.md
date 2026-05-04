## Контент-завод: чистый поток до n8n

### 1. Новый webhook

`src/lib/contentFactory.ts`:
- `N8N_CONTENT_WEBHOOK = "https://n8n.zapoinov.com/webhook/clony-yurii"` (production, без `-test`).
- Оставляем 120-секундный таймаут и человеко-понятные ошибки (404 → подсказка активировать workflow, timeout → «n8n не ответил»).

### 2. Редактируемое ТЗ перед отправкой

Сейчас в `CreateStep3.tsx` блок «Посмотреть ТЗ перед отправкой» — read-only `<pre>`. Делаю его редактируемым:

- Для каждого выбранного стиля держу `editedBriefs: Record<StyleId, string>` в стейте.
- В Collapsible — `<textarea>` с автоhigh, кнопки **«Сохранить»**, **«Сбросить к авто»**, **«Копировать»**.
- При первом открытии заполняю `editedBriefs[sid] = built.technicalBrief`.
- Если `editedBriefs[sid]` есть — `payload.finalPrompt = editedBriefs[sid]` и `design.currentStyle.technicalBrief = editedBriefs[sid]` + флаг `design.currentStyle.userEdited = true`. Иначе — авто-бриф как сейчас.
- Бейдж «Отредактировано» рядом со стилем, если бриф изменён.

### 3. Переименовать кнопку

Кнопка «Создать N вариантов» → **«Создать дизайн»** (одинаково для 1 и нескольких стилей). В состоянии загрузки — «Создаём дизайн…».

### 4. Гарантировать полный payload в webhook

Структура отправки на каждый стиль (сейчас почти всё уже есть, добавляю/проверяю):

```text
{
  source: "lovable.content-factory",
  submittedAt,
  task: "ad_creative" | "neuro_photo_session",
  finalPrompt,              // ← отредактированный ИЛИ авто technicalBrief
  contentType: { id, title, subtitle, category, tooltip },   // что хотите создать
  prompt,                   // сырой бриф пользователя
  source_input: {
    mode,                   // link | photo | description
    linkUrl, description, productName,
    photosCount, photos: [{ name, mimeType, size, dataUrl }],
    photosRole,             // face_reference | brand_assets
    extraInstructions
  },
  format: { aspect, lang, variants },                         // из шага 2
  design: {
    style: [...selectedStyles],
    currentStyle: {
      id, label, description, auto,
      brief: structured,    // composition, lighting, cameraAngle, colorTreatment, typography, ...
      technicalBrief,       // финальный текст промпта
      userEdited: boolean,
      avoid                 // negative prompt
    },
    auto, autoCandidates,
    angles,                 // [{id,label,description}] для нейрофото
    color: { id, label, swatch }
  }
}
```

Запрос идёт `Promise.allSettled` параллельно для всех стилей — N генераций стартуют одновременно, ошибка одного не валит остальные.

### 5. Скорость

- Готовлю `photoPayloads` (FileReader → dataURL) **один раз** перед циклом стилей и переиспользую для всех (сейчас тоже так), так что 4 стиля не пережимают фото 4 раза.
- Параллельный запуск уже есть.
- Прогресс-бар идёт «псевдо»-инкрементом до 85 % и резко в 100 % при ответе.

### 6. Что НЕ трогаю

- Шаги 1–2 (источник, формат) — там уже всё передаётся через `location.state`.
- Управление рекламой — оставляю как есть (вы правите параллельно).
- Warning «Function components cannot be given refs» в консоли — не ломает поведение, исходит от lovable-tagger в dev-режиме.

### Затронутые файлы

- `src/lib/contentFactory.ts` — новый URL.
- `src/pages/CreateStep3.tsx` — редактируемое ТЗ, новая кнопка, флаг `userEdited`, использование `editedBriefs[sid]` в `finalPrompt`/`technicalBrief`.
