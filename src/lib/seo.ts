/**
 * Единый источник правды по SEO: заголовки, описания, индексация, sitemap.
 *
 * Файл СПЕЦИАЛЬНО без импортов — его же читает сборочный скрипт
 * `scripts/generate-seo.mjs` (через esbuild), чтобы sitemap.xml, robots-правила
 * и статические HTML-заготовки собирались из тех же данных, что показывает
 * рантайм. Один список маршрутов — ноль расхождений между кодом и выдачей.
 */

export const SITE_URL = "https://www.markvision.kz";
export const SITE_NAME = "MarkVision AI";
export const SITE_LOCALE = "ru_RU";
export const TWITTER_HANDLE = "@MarkVisionAI";

/** Соцсети не исполняют JS: og:image должен быть абсолютным и всегда доступным. */
export const DEFAULT_OG_IMAGE =
  "https://storage.googleapis.com/gpt-engineer-file-uploads/0vhjQSTH5xMxv9BxCw4VdkGQPky2/social-images/social-1777971253437-12.webp";

export interface SeoRoute {
  /** Путь роутера. `:param` — динамический сегмент, в sitemap не попадает. */
  path: string;
  title: string;
  description: string;
  /** Смысловые запросы страницы. Не идут в <meta keywords> (Google его игнорирует
   *  с 2009 года) — это рабочая карта для текстов, заголовков и контекста. */
  keywords?: string[];
  /** true — страница в индексе и в sitemap. false — noindex. */
  index: boolean;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
  ogImage?: string;
  /** Тип og:website | article. */
  ogType?: "website" | "article";
  /** JSON-LD, добавляемый к базовым Organization/WebSite. */
  jsonLd?: Record<string, unknown>[];
}

const LAB_FAQ = [
  {
    q: "Это бесплатно?",
    a: "Да. Практикум полностью бесплатный. В конце я расскажу про программу AI Marketing Lab для тех, кто захочет пойти дальше. Сам практикум ни к чему не обязывает.",
  },
  {
    q: "Будет ли запись?",
    a: "Запись не гарантируется. Практикум рассчитан на живое участие: я показываю систему на своём экране и отвечаю на вопросы в реальном времени.",
  },
  {
    q: "Нужен ли опыт в маркетинге?",
    a: "Базовое понимание маркетинга будет плюсом, но освоить инструменты можно и без глубоких технических знаний. Программировать не нужно.",
  },
  {
    q: "Это курс по ChatGPT?",
    a: "Нет. Мы собираем систему, которая берёт маркетинг на себя: сайты, CRM, аналитику, отчёты, контент. ChatGPT — лишь один из инструментов внутри неё.",
  },
  {
    q: "Это только для таргетологов?",
    a: "Нет. Практикум полезен маркетологам, SMM-специалистам, владельцам небольших агентств и всем, кто хочет автоматизировать маркетинг.",
  },
];

/** Приватный раздел приложения: всегда noindex, в sitemap не попадает. */
function appRoute(path: string, title: string, description: string): SeoRoute {
  return { path, title, description, index: false };
}

export const SEO_ROUTES: SeoRoute[] = [
  // ─────────── Публичные страницы ───────────
  {
    path: "/",
    title: "MarkVision AI — реклама, CRM и сквозная аналитика в одном окне",
    description:
      "Платформа для маркетологов и агентств: запуск рекламы Meta, CRM с WhatsApp, сквозная аналитика от клика до продажи и AI-генерация контента.",
    keywords: [
      "автоматизация маркетинга",
      "сквозная аналитика",
      "crm для маркетингового агентства",
      "платформа для таргетолога",
      "ai маркетинг",
    ],
    index: true,
    changefreq: "weekly",
    priority: 1.0,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: `${SITE_URL}/`,
        description:
          "Платформа для запуска рекламы Meta, CRM с WhatsApp, сквозной аналитики и AI-генерации контента.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "KZT" },
      },
    ],
  },
  {
    path: "/lab",
    title: "AI Marketing Lab — практикум по автоматизации маркетинга",
    description:
      "Бесплатный практикум для маркетологов и таргетологов: система на базе AI, которая сама собирает стратегию и креативы и ведёт рекламу. Запуск клиента за пару часов.",
    keywords: [
      "практикум по ai маркетингу",
      "нейросети для маркетолога",
      "автоматизация работы таргетолога",
      "ai marketing lab",
      "обучение ai маркетингу",
      "как таргетологу зарабатывать больше",
    ],
    index: true,
    changefreq: "weekly",
    priority: 0.9,
    ogType: "article",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: LAB_FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  },

  // ─────────── Служебные публичные: доступны, но не в индексе ───────────
  {
    path: "/login",
    title: "Вход в MarkVision AI",
    description: "Вход в личный кабинет MarkVision AI.",
    index: false,
  },
  {
    path: "/reset-password",
    title: "Восстановление пароля — MarkVision AI",
    description: "Восстановление доступа к личному кабинету MarkVision AI.",
    index: false,
  },
  {
    // Дашборд клиента открывается по секретной ссылке-токену. Попадание такой
    // ссылки в индекс = публикация данных клиента, поэтому noindex обязателен.
    path: "/client/:token",
    title: "Отчёт по проекту — MarkVision AI",
    description: "Персональный отчёт по рекламе и продажам.",
    index: false,
  },

  // ─────────── Приложение (за логином) ───────────
  appRoute("/dashboard", "Дашборд — MarkVision AI", "Сводка по рекламе, лидам и продажам проекта."),
  appRoute("/metrics", "Показатели — MarkVision AI", "Ежедневные показатели рекламы и продаж."),
  appRoute("/ads", "Реклама — MarkVision AI", "Управление рекламными кабинетами и кампаниями Meta."),
  appRoute("/crm", "CRM — MarkVision AI", "Воронка продаж, лиды и переписка с клиентами."),
  appRoute("/calls", "История звонков — MarkVision AI", "Журнал звонков и их разбор."),
  appRoute("/sales-ai", "AI-РОП — MarkVision AI", "Разбор переписок и звонков отдела продаж."),
  appRoute("/ai-agents", "AI-агенты — MarkVision AI", "Настройка AI-агентов отдела продаж."),
  appRoute("/broadcasts", "Рассылки — MarkVision AI", "WhatsApp-рассылки по базе клиентов."),
  appRoute("/broadcasts/:id", "Рассылка — MarkVision AI", "Статистика и получатели рассылки."),
  appRoute("/leadgen", "Лидогенерация — MarkVision AI", "Источники лидов и их эффективность."),
  appRoute("/analytics", "Аналитика — MarkVision AI", "Сквозная аналитика от клика до продажи."),
  appRoute("/analytics/creatives", "Воронка креативов — MarkVision AI", "Эффективность креативов по всей воронке."),
  appRoute("/analytics/content", "Аналитика контента — MarkVision AI", "Показатели публикаций и охватов."),
  appRoute("/marketing/content-center", "Контент-центр — MarkVision AI", "Библиотека материалов проекта."),
  appRoute("/marketing/content-plan", "Контент-план — MarkVision AI", "Календарь публикаций и автопостинг."),
  appRoute("/marketing/content-plan/:id", "Публикация — MarkVision AI", "Карточка публикации контент-плана."),
  // Старый адрес автопостинга — редирект на контент-план.
  appRoute("/marketing/autopost", "Автопостинг — MarkVision AI", "Автопостинг перенесён в контент-план."),
  appRoute("/finance", "Финансы — MarkVision AI", "Планы, выручка и расходы проекта."),
  appRoute("/reports", "Отчёты — MarkVision AI", "Отчёты по рекламе и продажам для клиента."),
  appRoute("/settings", "Настройки — MarkVision AI", "Настройки проекта, команды и интеграций."),
  appRoute("/settings/connection", "Подключения — MarkVision AI", "Интеграции: Meta, WhatsApp, Instagram, телефония."),
  appRoute("/create/step-1", "Контент-завод — MarkVision AI", "Генерация креативов: выбор проекта и формата."),
  appRoute("/create/step-2", "Контент-завод — MarkVision AI", "Генерация креативов: бренд и стиль."),
  appRoute("/create/step-3", "Контент-завод — MarkVision AI", "Генерация креативов: результат и галерея."),
  appRoute("/create/neuro-photo", "Нейрофотосессия — MarkVision AI", "AI-фотосессия для бренда."),
  appRoute("/create/montage", "AI-монтаж — MarkVision AI", "Видео с AI-аватаром."),
  appRoute("/create/montage-lab", "Монтаж съёмки — MarkVision AI", "Автомонтаж отснятого видео."),
  appRoute("/create/reels", "Reels-видео — MarkVision AI", "Генерация вертикальных роликов."),
  appRoute("/projects/new", "Новый проект — MarkVision AI", "Мастер подключения нового проекта."),
  appRoute("/projects/:id/strategy", "Стратегия проекта — MarkVision AI", "Маркетинговая стратегия проекта."),
];

/** Пути, закрытые от роботов в robots.txt (префиксы). */
export const ROBOTS_DISALLOW: string[] = [
  "/client/",
  "/dashboard",
  "/metrics",
  "/ads",
  "/crm",
  "/calls",
  "/sales-ai",
  "/ai-agents",
  "/broadcasts",
  "/leadgen",
  "/analytics",
  "/marketing/",
  "/finance",
  "/reports",
  "/settings",
  "/create/",
  "/projects/",
  "/reset-password",
];

const FALLBACK: SeoRoute = {
  path: "*",
  title: "MarkVision AI — реклама, CRM и сквозная аналитика",
  description:
    "Платформа для маркетологов и агентств: реклама Meta, CRM с WhatsApp, сквозная аналитика и AI-генерация контента.",
  index: false,
};

/** Маршруты, которые реально попадают в sitemap.xml. */
export function indexableRoutes(): SeoRoute[] {
  return SEO_ROUTES.filter((r) => r.index && !r.path.includes(":"));
}

/** Подбор SEO-описания под конкретный URL (с учётом динамических сегментов). */
export function seoForPath(pathname: string): SeoRoute {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const exact = SEO_ROUTES.find((r) => r.path === clean);
  if (exact) return exact;

  for (const route of SEO_ROUTES) {
    if (!route.path.includes(":")) continue;
    const pattern = new RegExp(
      `^${route.path.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/")}$`,
    );
    if (pattern.test(clean)) return route;
  }
  return FALLBACK;
}

export function canonicalFor(pathname: string): string {
  const clean = pathname.replace(/\/+$/, "");
  return `${SITE_URL}${clean || "/"}`;
}
