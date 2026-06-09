# n8n: контракт webhook Контент-завода (фронт → n8n)

**Workflow:** Clony AI MarkVision — https://n8n.zapoinov.com/workflow/dCQ20aXv6B9LRjDe  
**Webhook:** `POST https://n8n.zapoinov.com/webhook/clony-yurii`  
**Прокси:** Supabase Edge `content-factory-proxy` (MarkVision)

## Обязательно

- JSON плоский на корне + полный дубль `body: { ...те же поля + вложенные блоки }`
- `username` — **только если** в проекте задан Instagram-ник (Контент-завод → «Ник на креативах», без `@`). Пустой ник → ключ **не** попадает в JSON.
- В `body` обязательно: `prompt`, `finalPrompt`, `technical_brief`, `user_brief`, `task`, `route`, `typeId`
- В `body` также: `source_input`, `format`, `design`, `marketing`, `contentType`, `angles` (нейро)
- Файлы **не** в multipart — только URL из Clony Storage (`content-factory-uploads`)
- 1 POST на каждый выбранный стиль
- `content_type` — строго из таблицы (иначе n8n → `fb-target`)

| typeId | content_type |
|--------|--------------|
| facebook-ads | fb-target |
| google-ads | **google-ads** |
| marketplace | marketplace |
| insta-carousel | insta-carousel |
| reels-cover | reels-cover |
| stories | instagram-stories |
| youtube-thumb | youtube |
| web-banner | banner |
| neuro-photo | neuro-photo |

## Нейрофото (жёсткий контракт)

Перед отправкой фронт валидирует `assertNeuroPhotoPayload()`:

- `content_type` / `route`: `neuro-photo`
- `task` / `generation_pipeline`: `neuro_photo_session`
- `neuro_photo_session`: true, `photos_role`: `face`
- `primary_face_url` + `people_photo_urls` — Supabase public URL
- `image_urls`: `[]`
- без `creative_format`, без CTA/overlay в marketing

## Env Lovable (обязательно для upload)

```
VITE_CLIENT_SUPABASE_URL=https://szfgdruhlebfvcmlvxdk.supabase.co
VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY=<clony anon key>
```

Без них селфи не зальётся → нейрофото не включится.

## Код

- `src/lib/contentFactoryWebhook.ts` — сборка полного payload (root + body)
- `src/lib/contentFactoryPayload.ts` — image_urls, marketing, format, assert
- `src/lib/contentFactoryRoutes.ts` — content_type map
- `src/pages/CreateStep3.tsx` — отправка
