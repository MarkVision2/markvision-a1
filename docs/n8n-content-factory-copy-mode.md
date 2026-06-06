# n8n: режим текста на креативе (copy_mode)

Воркфлоу: **Clony AI MarkVision** — https://n8n.zapoinov.com/workflow/dCQ20aXv6B9LRjDe  
Webhook: `clony-yurii`

## Новые поля в `body` (плоские, дубль в `body.*`)

| Поле | Тип | Значения | Описание |
|------|-----|----------|----------|
| `copy_mode` | string | `auto` \| `custom` | Режим текста |
| `copy_mode_label` | string | человекочитаемо | Для логов |
| `overlay_text` | string | текст или `""` | **Только custom** — дословная подпись |
| `overlay_text_required` | boolean | | `true` если `copy_mode=custom` |
| `use_exact_overlay_text` | boolean | | `true` если custom и текст не пустой |
| `extra_instructions` | string | | Пожелания для AI (режим auto) |

Поля уже в `prompt` / `finalPrompt` в блоке `--- Текст на креативе ---`.

## Логика в n8n (добавить после Webhook)

### 1. IF-нода «Copy mode»

```
Условие: {{ $json.body.copy_mode }} equals "custom"
```

**Ветка TRUE (custom):**
- Не вызывать LLM для генерации подписи.
- Взять текст: `{{ $json.body.overlay_text }}`
- Передать в image compositor / overlay-ноду как **фиксированный текст**.
- Промпт для image-gen дополнить: «Наложи ТОЧНО этот текст: {{ $json.body.overlay_text }}. Не менять формулировки.»

**Ветка FALSE (auto):**
- Использовать существующую chainLlm-ноду для сценария/подписи.
- Учитывать `goal`, `tone`, `cta_phrase`, `extra_instructions` из body.
- Сгенерированный текст → overlay.

### 2. Проверка custom без текста

```
IF: copy_mode = custom AND overlay_text пустой
→ status error в content_factory_results, message: "overlay_text required"
```

### 3. Image overlay / compositor

Для **custom** параметры overlay-ноды:

| Параметр | Значение |
|----------|----------|
| `text` | `{{ $json.body.overlay_text }}` |
| `exact_match` | `true` |
| `allow_llm_rewrite` | `false` |

Для **auto**:

| Параметр | Значение |
|----------|----------|
| `text` | `{{ $node["LLM Copy"].json.text }}` |
| `exact_match` | `false` |

### 4. Пример Set-ноды перед генерацией

```javascript
const mode = $json.body.copy_mode || 'auto';
const overlay = ($json.body.overlay_text || '').trim();

return {
  copy_mode: mode,
  final_overlay_text: mode === 'custom' ? overlay : null,
  skip_copy_llm: mode === 'custom' && overlay.length > 0,
  copy_prompt_addon: mode === 'custom'
    ? `ОБЯЗАТЕЛЬНО используй дословно: «${overlay}»`
    : 'Сгенерируй продающую подпись по brief',
};
```

## Тестовые payload

**Auto:**
```json
{
  "copy_mode": "auto",
  "overlay_text": "",
  "overlay_text_required": false,
  "use_exact_overlay_text": false,
  "extra_instructions": "яркие цвета, акцент на скидку"
}
```

**Custom:**
```json
{
  "copy_mode": "custom",
  "overlay_text": "Скидка 30% до пятницы! Запишитесь бесплатно",
  "overlay_text_required": true,
  "use_exact_overlay_text": true,
  "extra_instructions": ""
}
```

## Важно

- Не переименовывать `copy_mode` / `overlay_text` без синхронного обновления фронта.
- При `custom` CTA из `cta_phrase` **не подменяет** `overlay_text` — приоритет у пользовательского текста.
