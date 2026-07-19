# ТЗ: настройка тегов в GTM для конверсии «клик по WhatsApp»

**Контейнер:** `GTM-WZGDTTJ6` (аккаунт GTM «Святой Юрий» → контейнер med-marketing1.vercel.app)
**Сайт:** med-marketing1.vercel.app
**Цель:** при клике по кнопке WhatsApp засчитывать конверсию в Google Ads (+ событие в GA4).

## Что уже сделано (не трогать)
- Контейнер `GTM-WZGDTTJ6` установлен на сайт (скрипт в `<head>`, noscript-iframe в `<body>`).
- На все кнопки WhatsApp повешено `dataLayer.push({ event: 'whatsapp_click' })`.
- Создан GA4-ресурс (Measurement ID `G-B0LG2TFVBY`) и конверсия Google Ads «WhatsApp клик».

## Идентификаторы (использовать как есть)
| Параметр | Значение |
|---|---|
| GA4 Measurement ID | `G-B0LG2TFVBY` |
| Google Ads Conversion ID | `600737642` |
| Google Ads Conversion Label | `OEXxCIfE9M8cEOqOup4C` |
| Имя события (dataLayer) | `whatsapp_click` |

---

## Шаг 1. Триггер «WhatsApp клик»
GTM → **Триггеры → Создать**:
- Название: `WhatsApp клик`
- Тип триггера: **Специальное событие** (Custom Event)
- Имя события: `whatsapp_click`
- Условие запуска: **Все специальные события**
- Сохранить.

## Шаг 2. Тег GA4 (Google-тег)
GTM → **Теги → Создать**:
- Название: `GA4 — Google Tag`
- Тип тега: **Google-тег** (Google tag)
- Идентификатор тега: `G-B0LG2TFVBY`
- Триггер: **Initialization - All Pages** (или All Pages)
- Сохранить.

## Шаг 3. Тег «Google Ads Conversion Linker»
GTM → **Теги → Создать**:
- Название: `Ads — Conversion Linker`
- Тип тега: **Связывание конверсий** (Conversion Linker)
- Триггер: **All Pages**
- Сохранить.

## Шаг 4. Тег конверсии Google Ads (на клик WhatsApp)
GTM → **Теги → Создать**:
- Название: `Ads — WhatsApp клик`
- Тип тега: **Отслеживание конверсий Google Рекламы** (Google Ads Conversion Tracking)
- Conversion ID: `600737642`
- Conversion Label: `OEXxCIfE9M8cEOqOup4C`
- Триггер: **WhatsApp клик** (из Шага 1)
- Сохранить.

## Шаг 5. Проверка (Предпросмотр)
- GTM → **Предварительный просмотр** → ввести `https://med-marketing1.vercel.app` → Connect.
- На сайте нажать кнопку WhatsApp.
- В окне Tag Assistant убедиться, что на событии `whatsapp_click` сработали теги
  «Ads — Conversion Linker», «GA4 — Google Tag» и «Ads — WhatsApp клик».

## Шаг 6. Публикация
- GTM → **Отправить** (Submit) → название версии, например `WhatsApp conversion` → **Опубликовать**.

---

## Приёмка
1. В Google Ads → Цели → Конверсии → «WhatsApp клик»: статус тега станет «Активно» (данные с задержкой до суток).
2. Тестовый клик по кнопке WhatsApp → в GA4 (Отчёты → В реальном времени) виден заход/событие.
3. Кампании Google Ads можно оптимизировать на конверсию «WhatsApp клик».

## Важно
- Не создавать дубли тегов Google (Google-тег на странице должен быть один — либо GA4, либо Ads; здесь GA4 Google-тег + отдельный тег конверсии Ads — это корректно).
- Auto-tagging в Google Ads должен быть включён (обычно включён) — для `gclid`.
