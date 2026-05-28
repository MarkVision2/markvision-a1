---
name: video-pipeline
description: Сквозной конвейер создания видео из 5 инструментов — Claude (сценарий/код), Hyperframes (HTML→MP4), ElevenLabs (закадровый голос), Python (связывает всё в один процесс), FFmpeg (склейка видео+музыка+звук). Используй когда пользователь хочет сделать видео/рилс под ключ, "собери ролик", автоматизировать производство видео, связать HTML-рендер, озвучку и склейку в один прогон. Оркестрирует скилы hyperframes, elevenlabs, ffmpeg.
---

# Video Pipeline — видео под ключ из 5 инструментов

Конвейер с картинки: **Claude → Hyperframes → ElevenLabs → Python → FFmpeg**.

| Инструмент | Роль | Скил |
|---|---|---|
| **Claude** | пишет сценарий, HTML-вёрстку сцен, склеивающий код | (этот агент) |
| **Hyperframes** | HTML/CSS/JS → MP4 (визуал) | `hyperframes` |
| **ElevenLabs** | текст → профессиональный закадровый голос | `elevenlabs` |
| **Python** | связывает всё в один процесс (оркестрация) | `scripts/build.py` |
| **FFmpeg** | склеивает видео, музыку и звук в финал | `ffmpeg` |

## Поток данных

```
сценарий (Claude)
   ├─► HTML сцены ──[hyperframes render]──► video.mp4
   └─► текст озвучки ──[elevenlabs tts.py]──► voice.mp3
                                              │
        music.mp3 (опц.) ───────────────────►├─[ffmpeg amix + map]─► final.mp4
                                video.mp4 ───►┘
```

## Предусловия

- Node 22+ и `ffmpeg` в PATH (см. скил `ffmpeg`, если FFmpeg не установлен).
- `export ELEVENLABS_API_KEY=...` для озвучки.

## Быстрый прогон

`scripts/build.py` оркеструет шаги (Python = «клей»):

```bash
python3 .claude/skills/video-pipeline/scripts/build.py \
  --project ./my-video \
  --script script.txt \
  --music music.mp3 \
  --out final.mp4
```

Скрипт: рендерит Hyperframes-проект (`npx hyperframes render`), генерит голос из `--script` через хелпер ElevenLabs, затем домикширует голос (+опциональную музыку) к видео через FFmpeg. Без `--music` музыкальная дорожка пропускается; без `--script` — этап озвучки пропускается.

## Ручной процесс (по шагам)

1. **Сценарий (Claude):** разбей идею на сцены и текст закадра.
2. **Визуал (hyperframes):** свёрстай сцены в HTML, расставь `data-start`/`data-duration`, `npx hyperframes render` → `video.mp4`.
3. **Голос (elevenlabs):** `python3 .claude/skills/elevenlabs/scripts/tts.py --file script.txt --out voice.mp3`.
4. **Сборка (ffmpeg):** домикшируй голос и музыку к видео (рецепты в скиле `ffmpeg`).
5. **Формат:** при необходимости приведи к 9:16 для рилсов.
