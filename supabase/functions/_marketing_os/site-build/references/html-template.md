# HTML-шаблон лендинга

Базовая структура. Адаптируй под конкретный проект и ТЗ.

## Базовый скелет

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TITLE_FROM_BRIEF</title>
  <meta name="description" content="DESCRIPTION_FROM_BRIEF">

  <!-- Open Graph -->
  <meta property="og:title" content="TITLE">
  <meta property="og:description" content="DESCRIPTION">
  <meta property="og:image" content="/og-image.jpg">

  <!-- Tailwind CSS через CDN -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    :root {
      --primary: #2563eb;
      --primary-dark: #1e40af;
      --dark: #0f172a;
      --accent: #fbbf24;
    }
    body { font-family: 'Inter', sans-serif; }
    .btn-primary {
      background: var(--primary);
      transition: background 0.2s;
    }
    .btn-primary:hover { background: var(--primary-dark); }
  </style>

  <!-- TODO: вставить ID Яндекс.Метрики -->
  <!-- TODO: вставить VK Pixel -->
</head>
<body class="bg-white text-slate-900">

  <!-- BL1: Hero -->
  <section class="min-h-screen flex items-center px-6 py-12 md:px-12 bg-gradient-to-br from-slate-50 to-white">
    <div class="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
      <div>
        <h1 class="text-4xl md:text-6xl font-bold leading-tight mb-6">
          H1_FROM_BRIEF
        </h1>
        <p class="text-xl text-slate-600 mb-8">
          H2_FROM_BRIEF
        </p>
        <a href="#offer" class="btn-primary inline-block px-8 py-4 rounded-lg text-white font-semibold text-lg">
          CTA1_TEXT
        </a>
        <div class="mt-6 flex items-center gap-4 text-sm text-slate-500">
          <span>✓ TRUST_INDICATOR_1</span>
          <span>✓ TRUST_INDICATOR_2</span>
        </div>
      </div>
      <div>
        <!-- TODO: hero-изображение/видео -->
        <div class="aspect-video bg-slate-200 rounded-xl"></div>
      </div>
    </div>
  </section>

  <!-- BL2: Social proof -->
  <section class="py-12 px-6 border-y border-slate-200">
    <div class="max-w-6xl mx-auto">
      <p class="text-center text-sm text-slate-500 uppercase tracking-wide mb-8">
        SOCIAL_PROOF_LABEL
      </p>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-8 items-center">
        <!-- цифры или лого -->
      </div>
    </div>
  </section>

  <!-- BL3: Problem — связка с P1 -->
  <section class="py-20 px-6 bg-slate-50">
    <div class="max-w-4xl mx-auto text-center">
      <h2 class="text-3xl md:text-4xl font-bold mb-8">
        PROBLEM_HEADLINE
      </h2>
      <div class="grid md:grid-cols-3 gap-8 text-left mt-12">
        <div class="bg-white p-6 rounded-xl">
          <div class="text-2xl mb-3">😩</div>
          <p class="text-slate-600">PAIN_POINT_1</p>
        </div>
        <!-- еще 2 карточки -->
      </div>
    </div>
  </section>

  <!-- BL4: Solution -->
  <section class="py-20 px-6">
    <div class="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
      <div>
        <h2 class="text-3xl md:text-4xl font-bold mb-6">SOLUTION_HEADLINE</h2>
        <p class="text-lg text-slate-600 mb-6">SOLUTION_TEXT</p>
      </div>
      <div class="aspect-video bg-slate-100 rounded-xl"></div>
    </div>
  </section>

  <!-- BL5: How it works -->
  <section class="py-20 px-6 bg-slate-50">
    <div class="max-w-5xl mx-auto">
      <h2 class="text-3xl md:text-4xl font-bold text-center mb-16">HOW_IT_WORKS_HEADLINE</h2>
      <div class="grid md:grid-cols-3 gap-8">
        <div class="text-center">
          <div class="w-16 h-16 rounded-full btn-primary text-white flex items-center justify-center text-2xl font-bold mx-auto mb-4">1</div>
          <h3 class="font-bold text-xl mb-3">STEP_1_TITLE</h3>
          <p class="text-slate-600">STEP_1_TEXT</p>
        </div>
        <!-- шаги 2, 3 -->
      </div>
    </div>
  </section>

  <!-- BL6: Results -->
  <section class="py-20 px-6">
    <div class="max-w-6xl mx-auto">
      <h2 class="text-3xl md:text-4xl font-bold text-center mb-16">RESULTS_HEADLINE</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <!-- карточки с отзывами -->
      </div>
    </div>
  </section>

  <!-- BL7: Offer -->
  <section id="offer" class="py-20 px-6 bg-slate-900 text-white">
    <div class="max-w-4xl mx-auto text-center">
      <h2 class="text-3xl md:text-5xl font-bold mb-6">OFFER_HEADLINE</h2>
      <div class="bg-slate-800 rounded-2xl p-8 md:p-12 mt-12 text-left">
        <h3 class="text-2xl font-bold mb-6">Что входит:</h3>
        <ul class="space-y-3 mb-8">
          <li class="flex gap-3"><span class="text-green-400">✓</span> OFFER_ITEM_1</li>
          <!-- остальные пункты -->
        </ul>
        <div class="text-center">
          <p class="text-5xl font-bold mb-2">PRICE</p>
          <p class="text-slate-400 line-through">OLD_PRICE</p>
          <a href="#form" class="btn-primary inline-block mt-6 px-10 py-4 rounded-lg text-white font-semibold text-lg">CTA2_TEXT</a>
          <p class="text-sm text-slate-400 mt-4">GUARANTEE_TEXT</p>
        </div>
      </div>
    </div>
  </section>

  <!-- BL8: FAQ -->
  <section class="py-20 px-6">
    <div class="max-w-3xl mx-auto">
      <h2 class="text-3xl md:text-4xl font-bold text-center mb-12">Частые вопросы</h2>
      <div class="space-y-4">
        <details class="border border-slate-200 rounded-lg p-6">
          <summary class="font-semibold cursor-pointer">FAQ1_QUESTION</summary>
          <p class="mt-4 text-slate-600">FAQ1_ANSWER</p>
        </details>
        <!-- FAQ2, FAQ3... -->
      </div>
    </div>
  </section>

  <!-- BL9: Final CTA -->
  <section id="form" class="py-20 px-6 bg-gradient-to-br from-blue-600 to-blue-800 text-white">
    <div class="max-w-2xl mx-auto text-center">
      <h2 class="text-3xl md:text-4xl font-bold mb-6">FINAL_CTA_HEADLINE</h2>
      <form class="bg-white text-slate-900 p-8 rounded-xl mt-8 space-y-4">
        <!-- TODO: подключить к CRM -->
        <input type="text" placeholder="Имя" class="w-full px-4 py-3 border border-slate-300 rounded-lg">
        <input type="tel" placeholder="Телефон" class="w-full px-4 py-3 border border-slate-300 rounded-lg">
        <button type="submit" class="btn-primary w-full py-4 rounded-lg text-white font-semibold text-lg">CTA3_TEXT</button>
        <p class="text-xs text-slate-500">Нажимая кнопку, соглашаетесь с политикой конфиденциальности</p>
      </form>
    </div>
  </section>

  <!-- BL10: Footer -->
  <footer class="py-12 px-6 bg-slate-900 text-slate-400">
    <div class="max-w-6xl mx-auto text-center">
      <p>© 2026 COMPANY_NAME</p>
      <p class="mt-2 text-sm">Все права защищены</p>
    </div>
  </footer>

</body>
</html>
```

## Правила адаптации

1. Заменяй все `UPPERCASE_PLACEHOLDERS` на реальные тексты из ТЗ
2. Коды блоков (`BL1`, `BL2`...) оставляй в комментариях для навигации
3. Цветовые переменные в `:root` — меняй под бренд проекта
4. Формы и пиксели — оставляй заглушки `TODO` с комментариями
5. Иконки в BL3/BL5 — можно просто emoji (😩 ⚡ 🚀) или инлайн SVG
