# n8n: нейрофотосессия с лицом человека

Воркфлоу: **Clony AI MarkVision** — https://n8n.zapoinov.com/workflow/dCQ20aXv6B9LRjDe

## Когда срабатывает

| Сценарий на фронте | `generation_pipeline` | `task` |
|--------------------|----------------------|--------|
| Формат «Нейрофотосессия» + селфи | `neuro_photo_session` | `neuro_photo_session` |
| Любой формат (FB, баннер…) + фото людей | `neuro_face_banner` | `neuro_photo_session` |
| Без фото людей | `ad_creative` | `ad_creative` |

## Новые поля в `body`

| Поле | Тип | Описание |
|------|-----|----------|
| `face_reference_enabled` | boolean | Есть референс лица |
| `generation_pipeline` | string | `neuro_photo_session` \| `neuro_face_banner` \| `ad_creative` |
| `neuro_photo_session` | boolean | `true` → идти в ветку нейрофото |
| `face_preserve_identity` | boolean | Сохранять черты лица |
| `primary_face_url` | string | **Главное** фото лица (первое из `people_photo_urls`) |
| `face_photo_count` | number | Количество фото людей |
| `people_photo_urls` | string[] | Все URL референсов лица |
| `output_content_type` | string | Формат баннера: `fb-target`, `banner`, `neuro-photo`… |
| `output_format_label` | string | Человекочитаемое название формата |
| `photos_role` | string | `face` при нейролице, `brand_assets` без лица |

`content_type` / `route` — **формат выхода** (не менять).  
`task` = `neuro_photo_session` — **как генерировать** (с лицом).

## Логика в n8n (добавить после Webhook)

### 1. IF: нейропайплайн

```
{{ $json.body.face_reference_enabled }} === true
OR {{ $json.body.neuro_photo_session }} === true
```

### 2. Ветка TRUE — Neuro Face

**2a. Подготовка (Set node)**

```javascript
const body = $json.body;
const pipeline = body.generation_pipeline || 'neuro_photo_session';
const faceUrl = body.primary_face_url || (body.people_photo_urls || [])[0] || '';
const outputType = body.output_content_type || body.content_type;

return {
  pipeline,
  face_url: faceUrl,
  output_type: outputType,
  identity_prompt: pipeline === 'neuro_face_banner'
    ? `Создай ${outputType} баннер с УЗНАВАЕМЫМ лицом человека с фото ${faceUrl}. Не менять черты лица.`
    : `Нейрофотосессия: студийные кадры с лицом ${faceUrl}, сохранить identity.`,
};
```

**2b. Image generation**

- **Input image / IP-Adapter / Face swap**: `primary_face_url`
- **Prompt**: `body.prompt` + `identity_prompt`
- **Negative**: `different person, wrong face, face swap artifact, distorted face`

**2c. Для `neuro_face_banner`**

Дополнительно в промпт:
- Формат из `output_content_type` (fb-target → рекламный креатив Meta)
- CTA, текст из `copy_mode` / `overlay_text`
- Логотип из `logo_url` если есть

**2d. Switch по `generation_pipeline`**

| pipeline | Действие |
|----------|----------|
| `neuro_face_banner` | 1 image-gen с лицом + композиция баннера под `output_content_type` |
| `neuro_photo_session` | серия кадров / углы из `design.angles` |

### 3. Ветка FALSE

Существующая логика `ad_creative` без face reference.

## Приоритет URL лиц

```
primary_face_url  →  people_photo_urls[0]  →  image_urls[0] (fallback)
```

Фронт кладёт людей **первыми** в `image_urls` после логотипа.

## Примеры payload

**Facebook Ads + фото человека:**
```json
{
  "task": "neuro_photo_session",
  "content_type": "fb-target",
  "generation_pipeline": "neuro_face_banner",
  "face_reference_enabled": true,
  "primary_face_url": "https://.../people/00-uuid.jpg",
  "people_photo_urls": ["https://.../people/00-uuid.jpg"],
  "output_content_type": "fb-target",
  "photos_role": "face_reference"
}
```

**Нейрофотосессия + селфи:**
```json
{
  "task": "neuro_photo_session",
  "content_type": "neuro-photo",
  "generation_pipeline": "neuro_photo_session",
  "face_reference_enabled": true,
  "primary_face_url": "https://.../people/00-uuid.jpg"
}
```

## Ошибки

| Условие | Действие |
|---------|----------|
| `neuro_photo_session` + пустой `primary_face_url` | INSERT error в `content_factory_results` |
| Face-gen fail | `status: error`, `error_message: face_identity_failed` |

## Связь с copy_mode

При `copy_mode=custom` текст накладывается **поверх** баннера с лицом — порядок: face-gen → compositor → overlay text.
