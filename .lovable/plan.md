## Проблема

Фото-креативы рендерятся чётко (используем `image_url` — полноразмерный постер от Meta). Видео-креативы выглядят размыто, потому что Meta в `creative.thumbnail_url` отдаёт картинку **64×64**, и при растягивании на карточку 9:16 она блюрится.

Текущий авто-рефреш (`meta-creative-refresh`) дёргает `thumbnails{}` у видео и берёт самый большой `uri` — но Meta для многих видео отдаёт `thumbnails` максимум **640×360** (горизонтально), что для вертикального 9:16 контейнера всё ещё мыло (плюс кроп по бокам).

## Цель

Везде, где есть видео-креатив — показывать **чёткий постер 1080×1920 (вертикаль)**, идентичный по качеству фото-креативам.

## План

### 1. Сервер: расширить `meta-creative-refresh`

- Запрашивать у Meta video поля: `source, picture, thumbnails{uri,width,height,is_preferred,scale}, format{width,height,picture}`.
- `format` возвращает массив форматов с превью разных ориентаций — выбираем тот, у которого `width/height ≈ 9/16` (или максимальный по площади среди вертикальных).
- Если ни один thumbnail/format не даёт ≥ 720px по высоте — fallback: захватить кадр из видео **на сервере** через ffmpeg (Edge Functions поддерживают через WASM-обёртку) ИЛИ переложить захват на клиент (см. шаг 2 — дешевле и надёжнее).
- Сохранять лучший URL в `meta_creatives.thumbnail_url` + новое поле `poster_url` (если хотим хранить отдельно высококачественный постер, не теряя оригинал Meta).

### 2. Клиент: захватывать постер из самого видео

Самый надёжный способ получить чёткий вертикальный постер — взять **первый кадр mp4** прямо в браузере:

- В `CreativeCard` для видео-креативов с `looksLowRes === true`:
  1. Через edge-функцию получить свежий `video_url` (уже есть).
  2. Создать скрытый `<video crossOrigin="anonymous" preload="metadata">`, выставить `currentTime = 0.1`.
  3. На событие `seeked` нарисовать кадр на `<canvas>` (1080×1920), получить `dataURL` (jpeg, q=0.85).
  4. Загрузить blob в Supabase Storage (бакет `creative-posters`, путь `{cabinet_id}/{ad_id}.jpg`).
  5. Сохранить публичный URL в `meta_creatives.poster_url` через RPC/edge-функцию.
- На последующих рендерах использовать `poster_url` вместо `thumbnail_url` — он отдаётся с CDN Supabase, не протухает.

### 3. Хранилище

- Создать публичный bucket `creative-posters` (read public, write only через service role / edge).
- Миграция: добавить колонку `meta_creatives.poster_url text`.
- Edge-функция `meta-poster-upload`:
  - Принимает `ad_id` + jpeg-blob.
  - Проверяет, что юзер имеет доступ к кабинету этого креатива.
  - Кладёт в Storage, апдейтит `poster_url`.

### 4. Утилита `bestCreativeImage`

Обновить приоритет:

```text
poster_url → image_url → upscaleMetaThumb(thumbnail_url)
```

### 5. UX в карточке

- Пока постер генерится (видео ещё грузится в скрытом теге) — показывать blur-up плейсхолдер из текущего 64×64 (как сейчас), без раздражающего скачка.
- После готовности — мягкий fade-in нового постера.
- Кнопка Play и блюр-фон остаются.

### 6. Бэкфилл

- Одноразовая кнопка в Settings (или авто-batch при первом просмотре карточки) — пройтись по всем `creativeType='video' AND poster_url IS NULL` и сгенерировать постеры. На клиенте через очередь по 3 в параллель, чтобы не положить браузер.

## Технические детали

**Почему клиентский захват кадра, а не серверный ffmpeg:**
- Edge Functions Deno: ffmpeg только через wasm (медленно, лимит CPU 2с).
- Видео уже подгружается в плеер при открытии креатива — переиспользуем.
- Меньше нагрузка на edge, не нужен heavy worker.

**CORS:** Meta CDN (`fbcdn.net`) отдаёт видео с `Access-Control-Allow-Origin: *` — `crossOrigin="anonymous"` + `canvas.toDataURL()` будут работать без tainted-canvas. Если для какого-то домена не сработает — фолбэк: грузить mp4 fetch'ем через edge-проксю (`meta-video-proxy`), отдавать с нужными CORS-хедерами.

**Размер постера:** 1080×1920 jpeg q=0.85 ≈ 150–250 КБ. На 200 видео-креативов — ~40 МБ в Storage, копейки.

**Затрагиваемые файлы:**
- `supabase/functions/meta-creative-refresh/index.ts` — расширить fields.
- `supabase/functions/meta-poster-upload/index.ts` — новая функция.
- `supabase/migrations/...` — `poster_url` + bucket.
- `src/lib/metaThumb.ts` — учесть `posterUrl`.
- `src/hooks/useMetaStructure.ts` — пробросить `posterUrl`.
- `src/components/ads/CreativeCard.tsx` — захват кадра + загрузка.
- `src/components/dashboard/CreativesGrid.tsx` — то же поле.
- (опц.) `src/components/ads/CreativeExpanded.tsx` — использовать poster_url для `<video poster=...>`.

## Что **не** делаем

- Не трогаем фото-креативы (там всё ок).
- Не меняем дизайн карточки кроме fade-in постера.
- Не меняем формулы ROMI/метрик.
