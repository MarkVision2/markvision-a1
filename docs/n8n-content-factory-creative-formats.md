# n8n: форматы креатива (creative_format)

Воркфлоу: **Clony AI MarkVision** — https://n8n.zapoinov.com/workflow/dCQ20aXv6B9LRjDe  
Webhook: `clony-yurii`

Фронт (шаг 3) отправляет **реальные рекламные форматы**, а не абстрактные «стили».  
Главный routing-ключ: **`body.creative_format`** (или `body.style_id` — то же значение).

## Форматы (актуальный список)

| `creative_format` | `n8n_pipeline` | Что создавать |
|-------------------|----------------|---------------|
| `auto` | `format_auto` | ИИ выбирает лучший формат из кандидатов в `design.autoCandidates` |
| `testimonial` | `format_testimonial` | Карточка отзыва: лицо + цитата + звёзды + имя |
| `ugc` | `format_ugc` | Нативный UGC: селфи, человек + продукт, домашний свет |
| `before_after` | `format_before_after` | Современный split-screen ДО/ПОСЛЕ |
| `product_focus` | `format_product` | Продукт крупно, без людей, лайфстайл-контекст |
| `bold_offer` | `format_bold_offer` | Крупная типографика, оффер/скидка/цифра |
| `expert` | `format_expert` | Talking head: эксперт в камеру |

### Миграция со старых ID (deprecated)

| Старый `style_id` | Новый |
|-------------------|-------|
| `ugc_people`, `ugc_mixed` | `ugc` |
| `ugc_product` | `product_focus` |
| `talking_head` | `expert` |
| `typography`, `motion` | `bold_offer` |
| `studio` | `product_focus` или `auto` |

## Новые поля в `body` (плоские)

| Поле | Тип | Пример | Описание |
|------|-----|--------|----------|
| `style_id` | string | `testimonial` | Канонический ID (дубль `creative_format`) |
| `creative_format` | string | `ugc` | **Главный ключ Switch** |
| `creative_format_label` | string | `UGC` | Для логов |
| `creative_format_tag` | string | `Native` | Бейдж в UI |
| `creative_format_category` | string | `social` | `recommended` \| `social` \| `product` \| `text` |
| `n8n_pipeline` | string | `format_ugc` | Имя ветки в Switch |
| `format_output_hint` | string | | Что ожидает пользователь |
| `style` | string | `UGC` | Обратная совместимость (человекочитаемо) |

Поля **`prompt`** / **`finalPrompt`** уже содержат полное ТЗ с композицией, светом, типографикой — читать обязательно.

Вложенный блок **`design.currentStyle`** (для дебага):

```json
{
  "id": "testimonial",
  "label": "Отзыв",
  "description": "...",
  "auto": false,
  "brief": { "composition": "...", "lighting": "...", "promptTemplate": "..." },
  "technicalBrief": "полный текст для AI",
  "avoid": ["..."]
}
```

## Логика в n8n

### 1. Switch после Webhook — «Creative format»

```
Поле: {{ $json.body.creative_format }}
Режим: Rules

auto           → ветка Format Auto
testimonial    → ветка Format Testimonial
ugc            → ветка Format UGC
before_after   → ветка Format Before After
product_focus  → ветка Format Product
bold_offer     → ветка Format Bold Offer
expert         → ветка Format Expert
default        → fallback: прочитать body.prompt как есть
```

Альтернатива: Switch по `{{ $json.body.n8n_pipeline }}`.

### 2. Set-нода «Normalize format» (рекомендуется)

```javascript
const body = $json.body ?? $json;
const format = body.creative_format || body.style_id || 'auto';
const pipelines = {
  auto: 'format_auto',
  testimonial: 'format_testimonial',
  ugc: 'format_ugc',
  before_after: 'format_before_after',
  product_focus: 'format_product',
  bold_offer: 'format_bold_offer',
  expert: 'format_expert',
};
return {
  creative_format: format,
  n8n_pipeline: body.n8n_pipeline || pipelines[format] || 'format_auto',
  image_prompt: body.prompt || body.finalPrompt,
  use_people_ref: ['ugc', 'testimonial', 'expert', 'before_after'].includes(format),
  use_product_ref: ['ugc', 'product_focus', 'before_after', 'bold_offer'].includes(format),
  overlay_style: format === 'bold_offer' ? 'large_typography' : format === 'testimonial' ? 'quote_bubble' : 'minimal',
};
```

### 3. Что делать в каждой ветке

#### `format_auto`
- Прочитать `design.autoCandidates` или список из prompt.
- LLM-нода «Pick format»: выбрать один из `testimonial|ugc|before_after|product_focus|bold_offer|expert`.
- Перенаправить в соответствующую под-ветку (sub-switch).
- Записать выбранный формат в `content_factory_results.metadata.chosen_format`.

#### `format_testimonial`
- Image gen: портрет + speech-bubble + 5 звёзд.
- Copy LLM: сгенерировать цитату от первого лица (если `copy_mode=auto`).
- Overlay: имя + роль мелко под цитатой.
- Negative: агрессивный sales tone, мелкий текст.

#### `format_ugc`
- Image gen: вертикаль 9:16, селфи-ракурс, `image_urls[0]` как референс лица/продукта.
- Copy: короткий subtitle, нативный тон (`tone=ugc` или `native`).
- Negative: студийный свет, глянец.

#### `format_before_after`
- Image gen: split 50/50, левая десатурирована, правая яркая.
- Текст: крупные «ДО» / «ПОСЛЕ» (язык из `body.language`).
- Один субъект в обеих половинах.

#### `format_product`
- Image gen: flat-lay или 45°, без людей.
- `product_photo_urls` приоритетнее `image_urls`.
- Минимум текста.

#### `format_bold_offer`
- Compositor: текст 70–90% кадра.
- Copy LLM: короткий оффер (скидка/цифра), учитывать `goal` и `cta_phrase`.
- `copy_mode=custom` → дословно `overlay_text`.

#### `format_expert`
- Image gen: talking head по плечи, нейтральный фон.
- Overlay: имя/роль + субтитры из copy LLM.

### 4. Связь с copy_mode

См. `docs/n8n-content-factory-copy-mode.md`.

| Формат | При `copy_mode=auto` | При `copy_mode=custom` |
|--------|----------------------|-------------------------|
| testimonial | LLM → цитата в bubble | `overlay_text` в bubble |
| ugc | LLM → короткий subtitle | `overlay_text` снизу |
| bold_offer | LLM → крупный оффер | `overlay_text` = главный текст |
| expert | LLM → субтитры | `overlay_text` = реплика |
| before_after | LLM → подписи ДО/ПОСЛЕ | фиксированные подписи из `overlay_text` |
| product_focus | LLM → 1 строка бенефита | `overlay_text` опционально |

### 5. Запись в `content_factory_results`

Обязательно писать:

```json
{
  "request_id": "{{ body.request_id }}",
  "style_id": "{{ body.creative_format }}",
  "style_label": "{{ body.creative_format_label }}",
  "status": "done",
  "image_url": "...",
  "metadata": {
    "n8n_pipeline": "{{ body.n8n_pipeline }}",
    "creative_format_category": "{{ body.creative_format_category }}"
  }
}
```

## Тестовые payload

**Отзыв (testimonial):**
```json
{
  "creative_format": "testimonial",
  "style_id": "testimonial",
  "n8n_pipeline": "format_testimonial",
  "creative_format_label": "Отзыв",
  "style": "Отзыв",
  "prompt": "Создай креатив в формате ОТЗЫВА...",
  "copy_mode": "auto",
  "goal": "conversions",
  "tone": "ugc"
}
```

**UGC:**
```json
{
  "creative_format": "ugc",
  "n8n_pipeline": "format_ugc",
  "image_urls": ["https://..."],
  "people_photo_urls": ["https://..."],
  "aspect": "9:16"
}
```

**Авто:**
```json
{
  "creative_format": "auto",
  "n8n_pipeline": "format_auto",
  "design": {
    "autoCandidates": [
      { "id": "testimonial", "label": "Отзыв" },
      { "id": "ugc", "label": "UGC" }
    ]
  }
}
```

## Важно

- Не удалять `body.prompt` — там полное ТЗ с композицией и negative prompts.
- Switch делать по **`creative_format`**, не по `body.style` (строка-лейбл может меняться).
- При мульти-выборе (до 4 форматов) приходит **отдельный webhook на каждый** `request_id` = `{session_id}:{creative_format}`.
