---
name: elevenlabs
description: Генерирует профессиональную речь (text-to-speech) через ElevenLabs API — закадровый голос, озвучка рилсов и роликов "за клик". Используй когда нужно озвучить текст, сделать voiceover/закадр, сгенерировать голос, подобрать диктора, ElevenLabs TTS, добавить речь в видео. Часть видео-конвейера (Hyperframes + ElevenLabs + FFmpeg), см. скил video-pipeline.
---

# ElevenLabs — text-to-speech

Превращает текст в естественную речь. Используется для закадрового голоса в видео.

Docs: https://elevenlabs.io/docs

## Ключ API

Хелпер читает ключ из переменной окружения `ELEVENLABS_API_KEY`. **Не хардкодь ключ** в файлы и не коммить его.

```bash
export ELEVENLABS_API_KEY="..."
```

## Использование хелпера

`scripts/tts.py` — самодостаточный скрипт (только stdlib, без зависимостей):

```bash
python3 .claude/skills/elevenlabs/scripts/tts.py \
  --text "Привет, это закадровый голос." \
  --out voice.mp3

# или из файла со сценарием
python3 .claude/skills/elevenlabs/scripts/tts.py \
  --file script.txt --voice <VOICE_ID> --model eleven_multilingual_v2 --out voice.mp3
```

Флаги:
- `--text` / `--file` — текст напрямую или путь к файлу (один из двух обязателен)
- `--voice` — voice_id (по умолчанию Rachel `21m00Tcm4TlvDq8ikWAM`)
- `--model` — модель (по умолчанию `eleven_multilingual_v2`, поддерживает русский)
- `--out` — путь выходного аудио (по умолчанию `voice.mp3`)
- `--format` — `mp3_44100_128` (дефолт), `pcm_44100`, и т.д.

## Подбор голоса

Список доступных голосов:

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices \
  | python3 -c "import sys,json;[print(v['voice_id'],v['name']) for v in json.load(sys.stdin)['voices']]"
```

## Связка с видео

Сгенерированный `voice.mp3` либо подключается дорожкой `<audio>` в **hyperframes**, либо домикшивается к готовому видео через **ffmpeg** (`-filter_complex amix`). См. скил **video-pipeline**.
