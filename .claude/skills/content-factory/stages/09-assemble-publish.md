# Этап 9. Сборка, проверки, раскладка по сети

**Исполнитель:** дешёвая модель + скрипты. **Вход:** `scenes/*.json`, `avatar/*`, утверждение
с этапа 8. **Выход:** `out/<id>.mp4`, `out/publish.json`, задания в MarkVision.

## Сборка
1. Рендер Remotion, композиция `ReelsAvatar` (аватар поверх анимации, 4 раскладки).
   Пропсы — `scenes/<id>.json`, файл аватара кладётся в `remotion/public/` (имя `source.mp4`
   занято прокси монтажной съёмки — брать своё, например `avatar/<id>.mp4`).
   Новый ролик = своя `<Composition>` в `remotion/src/Root.tsx` (id без `_`), либо рендер
   существующей `ReelsAvatar` с `--props=`. Рендер только по команде с этапа 8:
   ```bash
   cd remotion && npx remotion render src/index.ts ReelsAvatar ../out/<id>.mp4 \
     --props=../work/factory/<project>/batches/<b>/scenes/<id>.json \
     --image-format=png --crf=14 --x264-preset=slow
   ```
2. Обложка: первый кадр **заменяет** первый кадр видео, а не добавляется перед ним. Иначе
   видео на секунду длиннее звука (реальный баг).
3. Музыка/фон/субтитры — по `format.md`. Звук аватара не обрабатывать.

## Проверки (обязательно, скриптом)
`node scripts/factory-check.mjs out/<id>.mp4` на каждый файл:
- длительность видео = длительность звука ± 0,1 с;
- 1080×1920, есть аудиодорожка, размер < 1 ГБ, длительность 3 с … 15 мин;
- код возврата ≠ 0 → ролик не готов, назад на сборку.

## `out/publish.json`
```json
[{"id":"…","file":"out/<id>.mp4","title":"…","caption":"…","hashtags":["…"],
  "topic_key":"…","account_id":"…","duration_sec":31.2}]
```
Описание, теги и ТГ-пост — по скиллу `publish-pack`, если нужны длинные тексты.

## Раскладка по сети (MCP `mcp/markvision`, ключ проекта из «Публикации → Настройки»)
1. На каждый ролик: `markvision_upload_media(file_path)` → `file_url`;
   `markvision_create_publication({file_url, title, caption, hashtags, duration_sec})`
   **без group_id/account_ids** — ролик принимается, задания не ставятся. Запомнить `video_id`.
2. Один вызов на пачку: `markvision_distribute({videos:[{id, topic_key}], batch_id:"<batch>",
   group_id|account_ids, per_day: 3, start_at})`. Правила: один ролик → один аккаунт, ≤ 3 в
   сутки на аккаунт, одна тема — разные дни и аккаунты. Ответ содержит `assignments`
   (кто/куда/когда) и `unassigned` (не влезло в горизонт `max_days`).
3. Записать ответ в `out/distribution.json`, итог в чат: роликов, аккаунтов, дней, стоимость
   пачки из `cost.json`, `unassigned`.

## После публикации
Через 48 ч — `markvision_metrics` / `markvision_list_jobs`: аккаунты с 0 просмотров на двух
роликах подряд — кандидаты на паузу (см. ТЗ §4.6), лидеры — на больший объём в следующей пачке.
