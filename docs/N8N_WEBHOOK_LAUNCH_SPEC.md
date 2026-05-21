# ТЗ: запуск рекламной кампании из сайта → n8n (workflow «AI‑targetolog Макс 1»)

**Endpoint:** `POST https://n8n.zapoinov.com/webhook/ai-target-launch`

**Content‑Type:** `application/json` (НЕ multipart/form-data — медиа передаётся URL‑ами, не файлами)

---

## 1. Почему URL, а не multipart

- Сайт уже загружает креативы в Supabase Storage и получает публичные URL → отдавай их как есть.
- n8n не упадёт в OOM из‑за base64 в RAM (раньше так и было — process крашился, и весь n8n зависал).
- Facebook `/advideos` сам скачивает по `file_url` (не нужно прокачивать через nas).
- Дебажить проще: URL виден в логах, открывается в браузере.
- Большие видео > 50 МБ всё равно нельзя слать как multipart — `body too large` упадёт раньше.

---

## 2. Контракт запроса

```jsonc
{
  // Идентификация
  "source": "lovable-webhook",               // ОБЯЗАТЕЛЬНО — иначе n8n пойдёт по старому пути
  "launchId": "<uuid>",                      // ОБЯЗАТЕЛЬНО — для трекинга в logs/Supabase

  // Facebook credentials и кабинет
  "ad_account_id": "act_394987113464047",    // ОБЯЗАТЕЛЬНО, с префиксом act_
  "ACCESS_TOKEN":  "EAAVblL...",             // ОБЯЗАТЕЛЬНО, long‑lived
  "PAGE_ID":       "188975824295014",        // ОБЯЗАТЕЛЬНО
  "INSTAGRAM_ID":  "17841...",               // опц. (для Instagram-плейсментов)
  "PIXEL_ID":      "2180509002767749",       // опц., если destination=website
  "PIXEL_EVENT":   "CONTACT",                // дефолт CONTACT, для website чаще "Lead"

  // Контакты клиента
  "WHATSAPP_NUMBER": "+77073824535",         // для destination=whatsapp
  "WEBSITE_URL":     "https://clinic.kz/lp", // для destination=website

  // Параметры кампании
  "destination": "whatsapp",                 // "whatsapp" | "website" | "leadform"
  "budget":      5,                          // в ДОЛЛАРАХ (n8n умножит на 100 → центы)
  "objective":   "MESSAGES",                 // MESSAGES | OUTCOME_LEADS | OUTCOME_TRAFFIC
  "serviceName": "Консультация",             // короткое название для имени кампании
  "leadFormId":  null,                       // обязательно для destination=leadform

  // Креатив
  "mediaType": "PHOTO",                      // PHOTO | VIDEO | CAROUSEL | INSTAGRAM_POST

  "mediaUrls": {
    // Для PHOTO:
    "feed":    "https://vhxu.supabase.co/storage/v1/object/public/creatives/<launchId>/feed.jpg",
    "stories": "https://vhxu.supabase.co/.../stories.jpg",   // опц. — лучше квалити, разные плейсменты

    // Для VIDEO:
    "video":   "https://.../creative_feed.mp4",
    "thumbnail": "https://.../thumb.jpg",                    // опц. — иначе FB сам возьмёт кадр

    // Для CAROUSEL (2–10 элементов):
    "carousel": [
      "https://.../img1.jpg",
      "https://.../img2.jpg",
      "https://.../img3.jpg"
    ]
  },

  // Для INSTAGRAM_POST (буст существующего поста):
  "instagramUrl": "https://www.instagram.com/p/Cxxx/",       // полный URL поста

  // Текст и контекст для AI
  "text": "Стоматология в Алматы — отбеливание со скидкой 30%",
  "plan": null                              // опц. готовый AI‑план (объект), если уже сгенерён на сайте
}
```

### Обязательные поля
`source`, `ad_account_id`, `ACCESS_TOKEN`, `PAGE_ID`, `destination`, `budget`, `mediaType` + минимум одна валидная ссылка в `mediaUrls`.

### Ответ от n8n
- **HTTP 200** + JSON:
  ```json
  { "ok": true, "launchId": "<uuid>", "adID": "120248...", "campaignId": "...", "adSetId": "..." }
  ```
- **HTTP 400** при ошибке валидации:
  ```json
  { "ok": false, "error": "ad_account_id is required" }
  ```
- **HTTP 500** при сбое FB API — будет с `error: "FB: <message>"`.

---

## 3. Требования к файлам в Supabase Storage

| Параметр | PHOTO (feed) | PHOTO (stories) | VIDEO | CAROUSEL |
|---|---|---|---|---|
| Соотношение | 1:1 (1080×1080) | 9:16 (1080×1920) | 4:5 или 9:16 | 1:1 |
| Формат | JPEG / PNG | JPEG / PNG | MP4 / MOV (H.264) | JPEG |
| Макс размер | 8 МБ | 8 МБ | **50 МБ** | 8 МБ каждое |
| Длительность видео | — | — | ≤ 60 сек | — |
| Bucket | `creatives` (public) | `creatives` (public) | `creatives` (public) | `creatives` (public) |
| Путь | `<launchId>/feed.<ext>` | `<launchId>/stories.<ext>` | `<launchId>/video.mp4` | `<launchId>/carousel_<idx>.jpg` |

**Bucket должен быть PUBLIC** (или подписанные URL со сроком жизни ≥ 30 минут — FB качает видео несколько минут).

---

## 4. Что сайт делает по шагам

1. Пользователь жмёт «Запустить кампанию».
2. Сайт загружает все креативы в Supabase Storage → получает массив URL.
3. Сайт POST'ит JSON по контракту выше.
4. n8n отвечает HTTP 200 / 400. **TTL ответа — до 60 сек** (FB /advideos качает с URL). На стороне сайта таймаут запроса — **120 сек**.
5. После 200 — сайт обновляет UI «Кампания запущена», сохраняет `adID` в свою таблицу `launches`.

---

## 5. Обратная совместимость

n8n поддерживает оба формата параллельно:
- **Новый (URL)** — JSON по контракту выше. Рекомендуется для всего нового кода.
- **Старый (multipart)** — продолжает работать с полем `payload` и приложенными файлами. Постепенно мигрировать на новый.

n8n определяет режим по полям: если есть `mediaUrls` → новый путь; иначе старый.

---

## 6. Что точно НЕ делать
- ❌ Не слать base64 файла в JSON — n8n упадёт по памяти.
- ❌ Не использовать localhost / private URLs в `mediaUrls` — FB не сможет скачать.
- ❌ Не передавать пароли/секреты других кабинетов в `clientConfig` — обращайся в `ad_account_id` и доставай токен через RLS Supabase.
- ❌ Не отправлять одновременно `video` и `carousel` — n8n возьмёт первый и проигнорирует остальное.

---

## 7. Сторона n8n (что реализовано)

| Узел | Что делает |
|---|---|
| `Webhook Запуск` | принимает POST JSON |
| `Parse Webhook` | определяет режим (URL vs multipart), валидирует, тянет `clientConfig` из Supabase (если не передан), грузит фото в FB `/adimages` через `file_url` или binary, грузит видео в FB `/advideos` через `file_url` |
| `Vertex Analyze Webhook` | только для PHOTO ≤ 8 МБ — отдаёт base64 в Gemini; для VIDEO в новом контракте пропускается |
| `creatives` → `Create Campaign` → `Create AdSet` → `Create Ad` | стандартная цепочка FB |
| `Respond OK` | финальный JSON с `adID` |

---

## 8. Контакты
- Воркфлоу: <https://n8n.zapoinov.com/workflow/w22K2SHiMLgrTIFD>
- Supabase: `https://vhxucdeumtxpwcktfein.supabase.co` (бакет `creatives`)
- Telegram отчёт о запуске приходит в группу клиента (`telegram_group_id` из `client_configs`)
