# Пакет для разработчика — новый сайт med-marketing1.vercel.app

**Цель:** конверсия = **клик по кнопке, ведущей на WhatsApp**. Реклама Google оптимизируется на этот клик.

Я уже всё создал в аккаунтах Google (ниже — готовые ID). Разработчику нужно **вставить код на сайт**.

---

## Все идентификаторы (уже созданы)

| Что | Идентификатор | Где |
|---|---|---|
| **GTM-контейнер** | `GTM-WZGDTTJ6` | аккаунт «Святой Юрий» → med-marketing1.vercel.app |
| **GA4 — Measurement ID** | `G-B0LG2TFVBY` | ресурс «med-marketing1», поток med-marketing1.vercel.app |
| **Google Ads — тег Google** | `G-25CXMTS1VZ` | аккаунт «Святой Маркетолог» 475-910-4949 |
| **Google Ads — конверсия «WhatsApp клик»** | `AW-600737642/OEXxCIfE9M8cEOqOup4C` | там же, категория «Контакт», по клику |

Дальше **два способа** установки. Выберите один. **Способ 1 (GTM) — рекомендую**, всё управляется из одного контейнера.

---

## СПОСОБ 1 — через Google Tag Manager (рекомендуется)

### Шаг 1. Вставить контейнер GTM на все страницы
Сразу после открывающего `<head>`:
```html
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-WZGDTTJ6');</script>
<!-- End Google Tag Manager -->
```
Сразу после открывающего `<body>`:
```html
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-WZGDTTJ6"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
```

### Шаг 2. На кнопку WhatsApp — отправлять событие в dataLayer
К кнопке/ссылке WhatsApp добавить обработчик клика:
```html
<a href="https://wa.me/7XXXXXXXXXX?text=Здравствуйте"
   onclick="dataLayer.push({'event':'whatsapp_click'});">
   Написать в WhatsApp
</a>
```

### Шаг 3. Настроить в GTM (внутри контейнера GTM-WZGDTTJ6)
1. **Триггер**: тип «Специальное событие», имя события `whatsapp_click`.
2. **Тег GA4 Configuration** (Google-тег): Measurement ID `G-B0LG2TFVBY`, триггер — All Pages.
3. **Тег «Google Ads Conversion Linker»**: триггер — All Pages (сохраняет gclid).
4. **Тег «Отслеживание конверсий Google Ads»**: Conversion ID `600737642`, Conversion Label `OEXxCIfE9M8cEOqOup4C`, триггер — тот самый `whatsapp_click`.
5. (опц.) Тег GA4 Event `generate_lead` на тот же триггер — чтобы клик был и в GA4.
6. **Опубликовать** контейнер (кнопка «Отправить»).

---

## СПОСОБ 2 — напрямую кодом (без GTM)

Если проще без GTM — вставьте теги напрямую.

### Шаг 1. В `<head>` — теги Google (аналитика + Ads)
```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-B0LG2TFVBY"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-B0LG2TFVBY');   // GA4 (аналитика)
  gtag('config', 'AW-600737642');   // Google Ads (конверсии + Conversion Linker)
</script>
```

### Шаг 2. На кнопке WhatsApp — вызывать конверсию
```html
<a href="https://wa.me/7XXXXXXXXXX?text=Здравствуйте"
   onclick="return gtag_report_conversion('https://wa.me/7XXXXXXXXXX?text=Здравствуйте');">
   Написать в WhatsApp
</a>
<script>
function gtag_report_conversion(url) {
  var callback = function () { if (typeof(url) != 'undefined') { window.location = url; } };
  gtag('event', 'conversion', {
      'send_to': 'AW-600737642/OEXxCIfE9M8cEOqOup4C',
      'value': 1.0,
      'currency': 'USD',
      'event_callback': callback
  });
  return false;
}
</script>
```

---

## Что заменить в коде
- `7XXXXXXXXXX` — реальный номер WhatsApp (в формате `77XXXXXXXXX`).
- Текст сообщения `?text=...` — по желанию.
- Всё остальное (`GTM-WZGDTTJ6`, `G-B0LG2TFVBY`, `AW-600737642/OEXxCIfE9M8cEOqOup4C`) — вставлять **как есть**.

## Проверка после установки
1. Открыть сайт, нажать кнопку WhatsApp.
2. В Google Ads → Конверсии → «WhatsApp клик»: статус тега станет «Активно» (данные с задержкой до суток).
3. В GA4 (Отчёты → В реальном времени) — виден заход и событие.
4. Инструмент Google **Tag Assistant** покажет срабатывание тегов на клик.

## Важно
- В Google Ads включить **auto-tagging** (обычно уже включён) — добавляет `gclid` в переходы.
- OAuth-приложение MarkVision сейчас на проверке у Google — на работу конверсий это не влияет.
- Аккаунт кампаний нового сайта: **Святой Маркетолог 475-910-4949** (под MCC 366-654-2845).
