---
name: hyperframes
description: Превращает HTML/CSS/JS в готовое MP4-видео (open-source движок HeyGen). Рендерит вёрстку в headless Chrome покадрово и собирает видео через FFmpeg. Используй когда нужно сделать видео из HTML, собрать рилс/ролик кодом, "HTML → видео", анимированный титр, моушн-графику, оформить кадры таймлайна data-атрибутами. Часть видео-конвейера (Hyperframes + ElevenLabs + FFmpeg), см. скил video-pipeline.
---

# Hyperframes — HTML → MP4

Open-source движок от HeyGen. Загружает HTML в headless Chrome, перематывает к каждому кадру (`frame = floor(time * fps)`), снимает скриншот и кодирует через FFmpeg. Детерминированный вывод: один и тот же HTML → один и тот же MP4.

Репозиторий: https://github.com/heygen-com/hyperframes · Docs: https://hyperframes.video/

## Предусловия

- **Node.js 22+** (`node -v`)
- **FFmpeg** в PATH (нужен для кодирования) — `ffmpeg -version`
- Chromium ставится автоматически вместе с Puppeteer при первом запуске

## Команды

```bash
npx hyperframes init my-video   # создать проект-заготовку
npx hyperframes preview          # превью в браузере с live-reload
npx hyperframes render           # отрендерить в MP4
```

## Таймлайн через data-атрибуты

Каждый элемент HTML — это «клип». Тайминг и слои задаются атрибутами:

| Атрибут | Назначение |
|---|---|
| `data-composition-id` | id композиции |
| `data-start` | момент появления (сек) |
| `data-duration` | длительность показа (сек) |
| `data-track-index` | слой микширования (видео/аудио) |
| `data-width` / `data-height` | размер холста (px) |

### Минимальный пример

```html
<div id="stage" data-composition-id="launch" data-start="0"
     data-width="1920" data-height="1080">
  <video data-start="0" data-duration="6" data-track-index="0" src="intro.mp4"></video>
  <h1    data-start="1" data-duration="4" data-track-index="1">Заголовок</h1>
  <audio data-start="0" data-duration="6" data-track-index="2" src="music.wav"></audio>
</div>
```

## Анимация

Анимации должны быть **seekable** (перематываемыми по кадрам). Поддерживаются GSAP, CSS-анимации, Lottie, Three.js, Anime.js, Web Animations API через frame-адаптеры. Избегай анимаций, завязанных на реальное время (`setInterval`, случайность без seed) — они ломают детерминизм.

## Типовой процесс

1. `npx hyperframes init <name>` — заготовка.
2. Свёрстать сцену в HTML/CSS, расставить `data-start`/`data-duration`/`data-track-index`.
3. `npx hyperframes preview` — проверить тайминги в браузере.
4. `npx hyperframes render` — получить MP4.
5. Озвучку класть отдельной дорожкой (`<audio>`) или домикшировать позже через скил **ffmpeg**.
