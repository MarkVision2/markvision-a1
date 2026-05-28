---
name: ffmpeg
description: Склеивает и обрабатывает видео, музыку и звук через FFmpeg — финальная сборка ролика. Используй когда нужно домикшировать закадровый голос к видео, добавить фоновую музыку, обрезать/склеить клипы, конвертировать формат, изменить разрешение/частоту кадров, сделать рилс 9:16, наложить субтитры. Часть видео-конвейера (Hyperframes + ElevenLabs + FFmpeg), см. скил video-pipeline.
---

# FFmpeg — сборка видео/аудио/музыки

Финальный этап: соединить видео из Hyperframes, голос из ElevenLabs и фоновую музыку в готовый ролик.

## Предусловие

`ffmpeg` должен быть в PATH. Проверка: `ffmpeg -version`.
Если нет — установить: `apt-get install -y ffmpeg` (Debian/Ubuntu) или `brew install ffmpeg` (macOS).

## Частые рецепты

**Озвучка поверх видео (заменить аудио):**
```bash
ffmpeg -i video.mp4 -i voice.mp3 -map 0:v -map 1:a -c:v copy -shortest out.mp4
```

**Голос + фоновая музыка (микс, музыку тише):**
```bash
ffmpeg -i video.mp4 -i voice.mp3 -i music.mp3 \
  -filter_complex "[2:a]volume=0.2[m];[1:a][m]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -shortest out.mp4
```

**Склеить клипы (одинаковый кодек) — через concat-список:**
```bash
printf "file '%s'\n" clip1.mp4 clip2.mp4 > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4
```

**Обрезать по времени:**
```bash
ffmpeg -ss 00:00:03 -to 00:00:10 -i in.mp4 -c copy clip.mp4
```

**Рилс 9:16 (1080×1920, crop по центру):**
```bash
ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:a copy reels.mp4
```

**Вшить субтитры:**
```bash
ffmpeg -i in.mp4 -vf "subtitles=subs.srt" out.mp4
```

**Извлечь/конвертировать аудио:**
```bash
ffmpeg -i in.mp4 -vn -acodec libmp3lame audio.mp3
```

## Замечания

- `-c:v copy` не перекодирует видео (быстро), но требует совместимых кодеков. При фильтрах (`-vf`/`-filter_complex`) видео перекодируется.
- `-shortest` обрезает результат по самой короткой дорожке — удобно когда голос короче видео.
- Для веба/соцсетей: `-c:v libx264 -pix_fmt yuv420p -movflags +faststart`.
