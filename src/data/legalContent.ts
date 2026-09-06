/**
 * Условия использования и Политика конфиденциальности MarkVision AI — публичные
 * страницы /terms и /privacy (src/pages/Legal.tsx). Их адреса указываются в
 * кабинетах разработчика площадок (TikTok for Developers, Meta, Google).
 *
 * Текст описывает реальную платформу: модули, интеграции и данные, которые
 * она обрабатывает (инвентаризация — docs/TIKTOK-DEVELOPER-APP.md, раздел
 * «Юридические страницы»). Реквизиты оператора — LEGAL_ORG (по справке о
 * госрегистрации ТОО); при смене адреса или email править только там.
 */

export type LegalLang = "ru" | "en";
export type LegalDoc = "terms" | "privacy";

/**
 * Реквизиты оператора платформы — по справке о государственной регистрации
 * юридического лица (egov.kz, 10.02.2026).
 */
export const LEGAL_ORG = {
  brand: "MarkVision AI",
  entity: { ru: "ТОО «MarkVision AI»", en: "MarkVision AI LLP" },
  bin: "260240010690",
  address: {
    ru: "Республика Казахстан, Павлодарская область, город Павлодар, улица Камзина, дом 41/1, кв. 82, 140011",
    en: "41/1 Kamzin Street, apt. 82, Pavlodar, Pavlodar Region, 140011, Republic of Kazakhstan",
  },
  director: { ru: "Запойнов Юрий Валерьевич", en: "Yuriy Zapoynov" },
  registered: { ru: "10 февраля 2026 г.", en: "10 February 2026" },
  site: "https://www.markvision.kz",
  email: "admin@markvision.kz",
  jurisdiction: { ru: "Республика Казахстан", en: "Republic of Kazakhstan" },
  effectiveDate: "2026-09-05",
};

/** Строка с полными реквизитами для разделов «Контакты». */
export function legalRequisites(lang: LegalLang): string {
  return lang === "ru"
    ? `${LEGAL_ORG.entity.ru}, БИН ${LEGAL_ORG.bin}. Адрес: ${LEGAL_ORG.address.ru}. Руководитель: ${LEGAL_ORG.director.ru}. Сайт: ${LEGAL_ORG.site}. Email: ${LEGAL_ORG.email}.`
    : `${LEGAL_ORG.entity.en}, Business Identification Number (BIN) ${LEGAL_ORG.bin}. Address: ${LEGAL_ORG.address.en}. Director: ${LEGAL_ORG.director.en}. Website: ${LEGAL_ORG.site}. Email: ${LEGAL_ORG.email}.`;
}

export interface LegalSection {
  id: string;
  title: string;
  /** Абзацы; строка, начинающаяся с «- », — пункт списка. */
  body: string[];
}

export interface LegalDocument {
  title: string;
  subtitle: string;
  effective: string;
  sections: LegalSection[];
}

const dateLabel = (lang: LegalLang) =>
  new Date(`${LEGAL_ORG.effectiveDate}T00:00:00Z`).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/* ═══════════════════════════════ ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ ═══════════════════════════════ */

const PRIVACY_RU: LegalDocument = {
  title: "Политика конфиденциальности",
  subtitle: "Какие данные обрабатывает платформа MarkVision AI, зачем, с кем делится и как их удалить.",
  effective: `Действует с ${dateLabel("ru")}`,
  sections: [
    {
      id: "scope",
      title: "1. О чём эта политика",
      body: [
        `Политика описывает обработку данных на платформе ${LEGAL_ORG.brand} (сайт ${LEGAL_ORG.site} и все его страницы, включая личный кабинет, публичные страницы и клиентские дашборды). Оператор — ${LEGAL_ORG.entity.ru} (БИН ${LEGAL_ORG.bin}, ${LEGAL_ORG.address.ru}), контакт: ${LEGAL_ORG.email}.`,
        "MarkVision AI — B2B-платформа для бизнеса и маркетинговых агентств: запуск рекламы, CRM, сквозная аналитика, производство контента с помощью ИИ, автопубликация в социальные сети и автоматизация продаж. Пользователи платформы — компании (наши клиенты) и их сотрудники.",
        "В отношении данных сотрудников клиента (учётные записи) мы выступаем оператором. В отношении данных, которые клиент загружает или получает через интеграции (его лиды, переписки, звонки, медиа), клиент — оператор данных, а MarkVision AI обрабатывает их по его поручению и только для оказания услуг.",
      ],
    },
    {
      id: "data",
      title: "2. Какие данные мы обрабатываем",
      body: [
        "- Учётные записи: email, пароль (хранится в виде хеша), имя, телефон, аватар, роль в команде, активный проект, журнал входов.",
        "- Данные проектов и бизнеса: название и ниша проекта, бриф (аудитория, УТП, бюджеты), финансовые планы, настройки воронок и этапов, шаблоны и правила автоматизации.",
        "- Данные клиентов наших клиентов (CRM): имя, телефон, email, город, услуга, сумма сделки, источник и UTM-метки, история статусов, задачи, комментарии менеджеров.",
        "- Переписки: сообщения WhatsApp и Instagram Direct, полученные через подключённые интеграции, вложения (сохраняются в хранилище платформы), статусы доставки рассылок и отписки.",
        "- Звонки: записи разговоров, полученные от подключённой телефонии (Binotel, Sipuni), их расшифровки и ИИ-оценки (модуль «AI РОП»), номера телефонов и длительность.",
        "- Медиа для производства контента: фотографии и селфи для нейрофотосессии, логотипы, референсы, отснятые видео с участием людей, сгенерированные изображения, видео и озвучка, тексты сценариев.",
        "- Данные подключённых платформ: токены доступа и идентификаторы аккаунтов Meta (Facebook, Instagram), Google (Google Ads, YouTube), TikTok, Threads, Telegram, WhatsApp, телефонии; статистика рекламных кампаний, публикаций и аудитории; список ваших опубликованных видео и их метрики.",
        "- Технические данные: IP-адрес и User-Agent при обращении к сервису, идентификаторы устройства и браузера, журналы запросов к внешним API (без секретов), сведения об использовании ИИ-функций для учёта расходов.",
      ],
    },
    {
      id: "sources",
      title: "3. Откуда данные поступают",
      body: [
        "- От вас и вашей команды — при регистрации, настройке проекта, загрузке файлов и работе в интерфейсе.",
        "- От платформ, которые вы подключаете через OAuth или ключи API (Meta, Google, TikTok, Threads, Telegram, WhatsApp, телефония) — строго в объёме прав, которые вы подтверждаете на странице согласия платформы.",
        "- От форм на ваших сайтах и лендингах, рекламных кабинетов и мессенджеров, которые передают заявки в CRM.",
        "- Из открытых источников — публичные посты конкурентов для «Радара идей» и справочники организаций для лидогенерации; такие данные используются только как аналитика и не объединяются с профилями людей.",
      ],
    },
    {
      id: "purposes",
      title: "4. Зачем мы обрабатываем данные",
      body: [
        "- Оказание услуг платформы: ведение CRM, запуск и аналитика рекламы, планирование и публикация контента, производство видео и изображений, отчётность.",
        "- Работа интеграций: синхронизация статистики, публикация ваших материалов в подключённые аккаунты, приём сообщений и звонков, отправка уведомлений в Telegram.",
        "- ИИ-функции: генерация текстов, сценариев, изображений и видео, расшифровка и оценка звонков и переписок, подсказки менеджерам. Модели не обучаются на ваших данных — они используются только для обработки конкретного запроса.",
        "- Безопасность и стабильность: авторизация, защита от злоупотреблений, диагностика ошибок, ограничение лимитов.",
        "- Исполнение требований закона и договора с клиентом.",
        "Правовые основания: договор с клиентом и его законные интересы, согласие (для OAuth-подключений и отдельных функций), требования законодательства.",
      ],
    },
    {
      id: "tiktok",
      title: "5. Интеграция с TikTok",
      body: [
        "Раздел «Подключение TikTok» использует официальные API TikTok for Developers: Login Kit (вход через TikTok), Display API (профиль и список видео) и Content Posting API (публикация видео и отправка черновиков).",
        "- При входе через TikTok мы получаем только те права, которые вы подтверждаете на странице TikTok: базовые сведения профиля (open_id, имя, аватар), при наличии права — @username, описание и статистику профиля, список ваших видео с метриками, возможность загрузить или опубликовать видео от вашего имени.",
        "- Эти данные используются, чтобы показать подключённый аккаунт в проекте, вести карточку аккаунта и аналитику публикаций, а также публиковать видео, которые вы выбираете и настраиваете сами (заголовок, приватность, комментарии, дуэты, стичи, раскрытие коммерческого контента).",
        "- Токены доступа TikTok хранятся в зашифрованном виде на сервере и не передаются третьим лицам. Мы не продаём данные TikTok и не используем их для рекламы третьих лиц.",
        "- Публикация выполняется только по вашей явной команде. Мы не размещаем контент без вашего участия и не изменяем настройки вашего аккаунта TikTok.",
        "- Отключить интеграцию можно в любой момент кнопкой «Отключить» в разделе — токен отзывается у TikTok, данные аккаунта удаляются из проекта. Также доступ можно отозвать в приложении TikTok: Настройки → Безопасность → Управление доступом приложений.",
        "- Кэш данных TikTok (профиль, список видео, метрики) хранится не дольше, чем это нужно для отображения и аналитики, и удаляется вместе с отключением аккаунта или удалением проекта.",
      ],
    },
    {
      id: "instagram",
      title: "6. Интеграция с Instagram",
      body: [
        "Раздел «Публикации» подключает профессиональные аккаунты Instagram (Business или Creator) через официальный Instagram API with Instagram Login приложения Meta «MarkVision AI». Подключение делает владелец аккаунта сам: входит в Instagram на странице Instagram и подтверждает права на экране согласия.",
        "- Мы запрашиваем два права: instagram_business_basic — чтобы показать подключённый аккаунт в проекте (идентификатор, @username, имя, аватар, число подписчиков, тип аккаунта); instagram_business_content_publish — чтобы публиковать Reels и посты от имени аккаунта.",
        "- Публикация выполняется только по команде пользователя проекта: ролик выбирается, подписывается и ставится в расписание в MarkVision. Мы не публикуем ничего без участия пользователя, не читаем личные сообщения и не изменяем настройки аккаунта Instagram.",
        "- По опубликованным нами постам мы получаем их идентификаторы и статистику (охват, просмотры, лайки, комментарии, сохранения, репосты) — она показывается в аналитике проекта и хранится вместе с проектом.",
        "- Токены доступа Instagram хранятся в зашифрованном виде на сервере, продлеваются автоматически и не передаются третьим лицам. Пароль от аккаунта Instagram мы не получаем и не храним.",
        "- Удаление данных. Отключите аккаунт кнопкой «Отключить» в сетке аккаунтов проекта — токен и данные профиля удаляются из платформы сразу, статистика постов удаляется вместе с проектом или по запросу. Отозвать доступ можно и в самом Instagram: Настройки → Безопасность → Приложения и сайты → MarkVision AI → Удалить. После отзыва токен перестаёт действовать, платформа помечает аккаунт как отключённый и удаляет его данные по запросу на " + LEGAL_ORG.email + " в течение 30 дней.",
      ],
    },
    {
      id: "processors",
      title: "7. Кому мы передаём данные",
      body: [
        "Данные передаются только поставщикам, без которых сервис не работает, и только в объёме, необходимом для конкретной функции:",
        "- Инфраструктура: Supabase (база данных, аутентификация, файловое хранилище, серверные функции), Vercel (хостинг сайта), Cloudflare R2 (хранение больших видеофайлов), n8n (оркестрация автоматизаций на собственном сервере).",
        "- Рекламные и социальные платформы, которые вы подключаете: Meta (Facebook, Instagram, Conversions API — хешированные контакты для атрибуции конверсий), Google (Google Ads, YouTube, офлайн-конверсии), TikTok, Threads, Telegram.",
        "- Коммуникации: WhatsApp через шлюз Green API или WhatsApp Web, телефония Binotel и Sipuni (записи звонков).",
        "- ИИ-провайдеры: OpenAI (тексты, расшифровка звонков), Google Gemini через шлюз Lovable AI (тексты и анализ), HeyGen (видео с аватарами), ElevenLabs (озвучка), Deepgram (расшифровка видео в пайплайне монтажа), kie.ai (изображения и видео), Pexels (стоковые видео).",
        "- Источники для аналитики: Apify и ScrapeCreators (публичные посты для «Радара идей»), 2GIS (справочник организаций), Национальный банк РК (курсы валют).",
        "Каждый поставщик обрабатывает данные по своим условиям и политике конфиденциальности; часть из них находится за пределами Республики Казахстан. Передача выполняется по защищённым каналам (HTTPS).",
      ],
    },
    {
      id: "cookies",
      title: "8. Cookies и аналитика",
      body: [
        "- В личном кабинете платформы используются только технические cookies и локальное хранилище браузера: сессия входа, выбранный проект, настройки интерфейса. Рекламные трекеры в кабинете не установлены.",
        "- На публичной маркетинговой странице /lab работают Google Tag Manager и Meta Pixel; события просмотра и заявки дублируются на сервер Meta (Conversions API) вместе с IP-адресом и User-Agent посетителя. Управлять такими cookies можно в настройках браузера.",
        "- Ссылки-редиректы платформы (/r, /g, /p) фиксируют факт перехода для атрибуции обращений.",
      ],
    },
    {
      id: "retention",
      title: "9. Сроки хранения",
      body: [
        "- Учётные записи и данные проектов — пока действует ваш доступ к платформе или пока вы не удалите проект.",
        "- Токены подключённых платформ — до отключения интеграции или истечения срока токена.",
        "- Материалы Контент-завода: загруженные референсы и фото — 14 дней, галерея результатов — 30 дней (удаляются автоматически).",
        "- Одноразовые коды OAuth-подключений — 15 минут.",
        "- Данные CRM, переписки, записи звонков и медиа клиента — в течение срока оказания услуг клиенту; по запросу клиента удаляются раньше. После прекращения договора данные удаляются в течение 30 дней, кроме случаев, когда закон требует хранить их дольше.",
      ],
    },
    {
      id: "security",
      title: "10. Как мы защищаем данные",
      body: [
        "- Доступ к данным разграничен по проектам и ролям на уровне базы данных (row-level security); токены платформ доступны только серверным функциям.",
        "- Токены аккаунтов социальных сетей шифруются ключом, который хранится отдельно от базы.",
        "- Все соединения защищены TLS; пароли хранятся в виде необратимых хешей.",
        "- Публичные ссылки на клиентские дашборды и медиафайлы содержат неугадываемые идентификаторы; доступ по ним можно отозвать в настройках.",
      ],
    },
    {
      id: "rights",
      title: "11. Ваши права",
      body: [
        "Вы вправе запросить доступ к своим данным, их исправление, удаление, ограничение обработки и копию в машиночитаемом виде, а также отозвать согласие на интеграцию (отключив её в настройках).",
        `Запросы принимаются на ${LEGAL_ORG.email}; мы отвечаем в течение 30 дней. Администратор компании-клиента может удалять лиды, проекты и учётные записи сотрудников прямо в интерфейсе платформы.`,
        "Если вы — клиент нашего клиента (например, оставили заявку на его сайте или звонили ему), обращайтесь к этой компании: она определяет цели обработки, а мы поможем ей выполнить ваш запрос.",
      ],
    },
    {
      id: "clients",
      title: "12. Обязанности клиента как оператора данных",
      body: [
        "Подключая интеграции и загружая данные, клиент подтверждает, что получил необходимые согласия от своих клиентов и сотрудников: на запись и анализ телефонных разговоров, на обработку переписок, на рассылки (с возможностью отписаться), на использование фотографий и видео людей для создания контента.",
        "Клиент обязан соблюдать правила подключённых платформ (Meta, Google, TikTok, Threads, WhatsApp) и не использовать платформу для спама, обмана или нарушения прав третьих лиц.",
      ],
    },
    {
      id: "children",
      title: "13. Дети",
      body: ["Платформа предназначена для бизнеса и не рассчитана на лиц младше 18 лет. Мы сознательно не собираем данные детей."],
    },
    {
      id: "changes",
      title: "14. Изменения политики",
      body: ["Мы можем обновлять политику при изменении функций и интеграций. Актуальная версия всегда доступна по адресу " + `${LEGAL_ORG.site}/privacy` + "; о существенных изменениях мы уведомляем в интерфейсе или по email."],
    },
    {
      id: "contacts",
      title: "15. Контакты",
      body: [legalRequisites("ru"), `Юрисдикция: ${LEGAL_ORG.jurisdiction.ru}. Запросы по персональным данным принимаются на ${LEGAL_ORG.email}.`],
    },
  ],
};

const PRIVACY_EN: LegalDocument = {
  title: "Privacy Policy",
  subtitle: "What data the MarkVision AI platform processes, why, who it is shared with and how to delete it.",
  effective: `Effective ${dateLabel("en")}`,
  sections: [
    {
      id: "scope",
      title: "1. What this policy covers",
      body: [
        `This policy describes data processing on the ${LEGAL_ORG.brand} platform (the website ${LEGAL_ORG.site} and all of its pages, including the workspace, public pages and client dashboards). The operator is ${LEGAL_ORG.entity.en} (BIN ${LEGAL_ORG.bin}, ${LEGAL_ORG.address.en}); contact: ${LEGAL_ORG.email}.`,
        "MarkVision AI is a B2B platform for businesses and marketing agencies: ad launch, CRM, end-to-end analytics, AI content production, auto-publishing to social networks and sales automation. Platform users are companies (our customers) and their employees.",
        "For employee accounts of a customer we act as the data controller. For data a customer uploads or receives through integrations (their leads, conversations, calls, media) the customer is the controller and MarkVision AI processes that data on the customer's behalf, only to provide the service.",
      ],
    },
    {
      id: "data",
      title: "2. Data we process",
      body: [
        "- Accounts: email, password (stored as a hash), name, phone, avatar, team role, active project, sign-in log.",
        "- Project and business data: project name and niche, brief (audience, USP, budgets), financial plans, pipeline and stage settings, templates and automation rules.",
        "- Our customers' customer data (CRM): name, phone, email, city, service, deal amount, source and UTM tags, status history, tasks, manager comments.",
        "- Conversations: WhatsApp and Instagram Direct messages received through connected integrations, attachments (stored in the platform storage), delivery statuses of campaigns and opt-outs.",
        "- Calls: call recordings received from connected telephony (Binotel, Sipuni), their transcripts and AI evaluations (the “AI Sales Lead” module), phone numbers and durations.",
        "- Media for content production: photos and selfies for AI photo sessions, logos, references, recorded footage of people, generated images, videos and voice-overs, script texts.",
        "- Connected platform data: access tokens and account identifiers for Meta (Facebook, Instagram), Google (Google Ads, YouTube), TikTok, Threads, Telegram, WhatsApp and telephony; statistics of ad campaigns, posts and audiences; the list of your published videos and their metrics.",
        "- Technical data: IP address and User-Agent of requests, device and browser identifiers, logs of calls to external APIs (without secrets), AI usage records for cost accounting.",
      ],
    },
    {
      id: "sources",
      title: "3. Where the data comes from",
      body: [
        "- From you and your team — at sign-up, project setup, file upload and while using the interface.",
        "- From platforms you connect via OAuth or API keys (Meta, Google, TikTok, Threads, Telegram, WhatsApp, telephony) — strictly within the permissions you confirm on the platform's consent screen.",
        "- From forms on your websites and landing pages, ad accounts and messengers that send leads into the CRM.",
        "- From public sources — public competitor posts for the “Idea Radar” and business directories for lead generation; such data is used only as analytics and is not merged with personal profiles.",
      ],
    },
    {
      id: "purposes",
      title: "4. Why we process data",
      body: [
        "- Providing the platform: CRM, ad launch and analytics, content planning and publishing, video and image production, reporting.",
        "- Running integrations: syncing statistics, publishing your materials to connected accounts, receiving messages and calls, sending Telegram notifications.",
        "- AI features: generating texts, scripts, images and videos, transcribing and evaluating calls and chats, suggestions for managers. Models are not trained on your data — it is used only to process a specific request.",
        "- Security and reliability: authentication, abuse prevention, error diagnostics, rate limiting.",
        "- Compliance with the law and the customer agreement.",
        "Legal bases: the agreement with the customer and their legitimate interests, consent (for OAuth connections and specific features), legal obligations.",
      ],
    },
    {
      id: "tiktok",
      title: "5. TikTok integration",
      body: [
        "The “TikTok connection” section uses the official TikTok for Developers APIs: Login Kit (sign in with TikTok), Display API (profile and video list) and Content Posting API (posting videos and sending drafts).",
        "- When you sign in with TikTok we receive only the permissions you confirm on the TikTok page: basic profile information (open_id, display name, avatar); with the corresponding scopes — @username, bio and profile statistics, the list of your videos with metrics, and the ability to upload or post a video on your behalf.",
        "- This data is used to show the connected account in the project, maintain the account card and publishing analytics, and to post videos that you select and configure yourself (title, privacy level, comments, duets, stitches, commercial content disclosure).",
        "- TikTok access tokens are stored encrypted on the server and are not shared with third parties. We do not sell TikTok data and do not use it for third-party advertising.",
        "- Posting happens only on your explicit command. We never publish content without your involvement and never change your TikTok account settings.",
        "- You can disconnect the integration at any time with the “Disconnect” button in the section — the token is revoked at TikTok and the account data is removed from the project. You can also revoke access in the TikTok app: Settings → Security → Manage app permissions.",
        "- Cached TikTok data (profile, video list, metrics) is kept no longer than needed for display and analytics and is deleted when the account is disconnected or the project is deleted.",
      ],
    },
    {
      id: "instagram",
      title: "6. Instagram integration",
      body: [
        "The “Publishing” section connects professional Instagram accounts (Business or Creator) through the official Instagram API with Instagram Login of the Meta app “MarkVision AI”. The account owner connects it personally: signs in on Instagram’s own page and confirms the permissions on the consent screen.",
        "- We request two permissions: instagram_business_basic — to show the connected account in the project (id, @username, name, avatar, follower count, account type); instagram_business_content_publish — to publish Reels and posts on behalf of the account.",
        "- Posting happens only on the command of a project user: the video is selected, captioned and scheduled in MarkVision. We never publish anything without the user’s involvement, never read direct messages and never change Instagram account settings.",
        "- For the posts we publish we receive their ids and statistics (reach, views, likes, comments, saves, shares); they are shown in the project analytics and stored together with the project.",
        "- Instagram access tokens are stored encrypted on the server, refreshed automatically and never shared with third parties. We never receive or store the Instagram account password.",
        "- Data deletion. Disconnect the account with the “Disconnect” button in the project’s account grid — the token and profile data are removed from the platform immediately; post statistics are deleted together with the project or on request. You can also revoke access inside Instagram: Settings → Security → Apps and websites → MarkVision AI → Remove. After revocation the token stops working, the platform marks the account as disconnected and deletes its data on request to " + LEGAL_ORG.email + " within 30 days.",
      ],
    },
    {
      id: "processors",
      title: "7. Who we share data with",
      body: [
        "Data is shared only with providers the service cannot work without, and only to the extent required for a specific feature:",
        "- Infrastructure: Supabase (database, authentication, file storage, server functions), Vercel (website hosting), Cloudflare R2 (large video storage), n8n (automation orchestration on our own server).",
        "- Ad and social platforms you connect: Meta (Facebook, Instagram, Conversions API — hashed contacts for conversion attribution), Google (Google Ads, YouTube, offline conversions), TikTok, Threads, Telegram.",
        "- Communications: WhatsApp via the Green API gateway or WhatsApp Web, Binotel and Sipuni telephony (call recordings).",
        "- AI providers: OpenAI (texts, call transcription), Google Gemini via the Lovable AI gateway (texts and analysis), HeyGen (avatar videos), ElevenLabs (voice-over), Deepgram (video transcription in the editing pipeline), kie.ai (images and video), Pexels (stock footage).",
        "- Analytics sources: Apify and ScrapeCreators (public posts for the Idea Radar), 2GIS (business directory), National Bank of Kazakhstan (exchange rates).",
        "Each provider processes data under its own terms and privacy policy; some of them are located outside the Republic of Kazakhstan. Transfers are made over secure channels (HTTPS).",
      ],
    },
    {
      id: "cookies",
      title: "8. Cookies and analytics",
      body: [
        "- The platform workspace uses only functional cookies and browser local storage: the sign-in session, the selected project, interface settings. No advertising trackers are installed in the workspace.",
        "- The public marketing page /lab runs Google Tag Manager and Meta Pixel; page view and lead events are mirrored to Meta servers (Conversions API) together with the visitor's IP address and User-Agent. You can manage such cookies in your browser settings.",
        "- Platform redirect links (/r, /g, /p) record the click for attribution of inquiries.",
      ],
    },
    {
      id: "retention",
      title: "9. Retention",
      body: [
        "- Accounts and project data — while your access to the platform is active or until you delete the project.",
        "- Tokens of connected platforms — until the integration is disconnected or the token expires.",
        "- Content Factory materials: uploaded references and photos — 14 days, results gallery — 30 days (deleted automatically).",
        "- One-time OAuth codes — 15 minutes.",
        "- CRM data, conversations, call recordings and customer media — for the duration of the service to the customer; deleted earlier on the customer's request. After the agreement ends the data is deleted within 30 days unless the law requires longer retention.",
      ],
    },
    {
      id: "security",
      title: "10. How we protect data",
      body: [
        "- Access is separated by project and role at the database level (row-level security); platform tokens are readable only by server functions.",
        "- Social network account tokens are encrypted with a key stored separately from the database.",
        "- All connections are protected by TLS; passwords are stored as irreversible hashes.",
        "- Public links to client dashboards and media files use unguessable identifiers; they can be revoked in the settings.",
      ],
    },
    {
      id: "rights",
      title: "11. Your rights",
      body: [
        "You may request access to your data, its correction, deletion, restriction of processing and a machine-readable copy, and withdraw consent to an integration by disconnecting it in the settings.",
        `Requests are accepted at ${LEGAL_ORG.email}; we respond within 30 days. A customer's administrator can delete leads, projects and employee accounts directly in the platform.`,
        "If you are a customer of our customer (for example, you left a request on their website or called them), please contact that company: it determines the purposes of processing, and we will help it fulfil your request.",
      ],
    },
    {
      id: "clients",
      title: "12. Customer obligations as a data controller",
      body: [
        "By connecting integrations and uploading data the customer confirms that it has obtained the necessary consents from its customers and employees: for recording and analysing phone calls, for processing conversations, for marketing messages (with an opt-out), and for using photos and videos of people to create content.",
        "The customer must comply with the policies of the connected platforms (Meta, Google, TikTok, Threads, WhatsApp) and must not use the platform for spam, deception or violation of third-party rights.",
      ],
    },
    {
      id: "children",
      title: "13. Children",
      body: ["The platform is intended for businesses and is not designed for persons under 18. We do not knowingly collect children's data."],
    },
    {
      id: "changes",
      title: "14. Changes to this policy",
      body: [`We may update this policy when features and integrations change. The current version is always available at ${LEGAL_ORG.site}/privacy; we notify about material changes in the interface or by email.`],
    },
    {
      id: "contacts",
      title: "15. Contacts",
      body: [legalRequisites("en"), `Jurisdiction: ${LEGAL_ORG.jurisdiction.en}. Personal data requests are accepted at ${LEGAL_ORG.email}.`],
    },
  ],
};

/* ═══════════════════════════════ УСЛОВИЯ ИСПОЛЬЗОВАНИЯ ═══════════════════════════════ */

const TERMS_RU: LegalDocument = {
  title: "Условия использования",
  subtitle: "Правила работы с платформой MarkVision AI для клиентов и их сотрудников.",
  effective: `Действует с ${dateLabel("ru")}`,
  sections: [
    {
      id: "acceptance",
      title: "1. Принятие условий",
      body: [
        `Настоящие условия регулируют использование платформы ${LEGAL_ORG.brand} (${LEGAL_ORG.site}), которую предоставляет ${LEGAL_ORG.entity.ru}, БИН ${LEGAL_ORG.bin} («мы»). Входя в платформу или используя её функции, вы принимаете эти условия и Политику конфиденциальности (${LEGAL_ORG.site}/privacy).`,
        "Если вы используете платформу от имени компании, вы подтверждаете, что уполномочены принять условия от её имени; «клиент» в этом документе — такая компания.",
      ],
    },
    {
      id: "service",
      title: "2. Что такое платформа",
      body: [
        "MarkVision AI — облачная платформа для маркетинга и продаж. В зависимости от подключённых модулей она включает:",
        "- Управление рекламой: запуск и оптимизация кампаний Meta и Google Ads, сквозная аналитика, таблица показателей, воронка по креативам.",
        "- Контент: Контент-завод (генерация креативов и нейрофотосессия), AI-монтаж и Reels-видео, контент-план, Радар идей, автопубликация в Instagram, TikTok, YouTube и Threads, раздел «Подключение TikTok».",
        "- Продажи: CRM, история звонков, AI РОП (анализ звонков и переписок), AI-агенты для мессенджеров, рассылки WhatsApp, лидогенерация.",
        "- Финансы и отчётность, стратегия проекта (Marketing OS), клиентские дашборды по ссылке.",
        "Состав модулей и лимиты определяются договором с клиентом. Мы можем развивать, изменять и отключать функции, уведомляя о существенных изменениях.",
      ],
    },
    {
      id: "accounts",
      title: "3. Учётные записи и команда",
      body: [
        "- Учётные записи создаёт администратор клиента или мы по его запросу. Вы отвечаете за сохранность пароля и за все действия под вашей учётной записью.",
        "- Администратор управляет ролями и доступом сотрудников к модулям и проектам; удаление сотрудника прекращает его доступ.",
        "- Немедленно сообщайте нам о несанкционированном доступе к учётной записи.",
      ],
    },
    {
      id: "integrations",
      title: "4. Подключённые платформы",
      body: [
        "- Интеграции с Meta, Google, TikTok, Threads, Telegram, WhatsApp и телефонией работают через официальные API и требуют вашего согласия на странице соответствующей платформы. Вы подключаете только те аккаунты, которыми вправе управлять.",
        "- Используя интеграции, вы также принимаете условия этих платформ (в том числе Условия обслуживания TikTok, Политики Meta, Условия Google API) и несёте ответственность за соблюдение их правил, включая правила о брендированном контенте, спаме и авторских правах.",
        "- Мы не являемся аффилированным лицом этих платформ. Они могут изменять API, ограничивать или отзывать доступ; мы не отвечаем за такие действия, но стараемся оперативно адаптировать платформу.",
        "- Вы можете отключить любую интеграцию в настройках; при этом токены доступа отзываются или удаляются.",
      ],
    },
    {
      id: "content",
      title: "5. Ваш контент и данные",
      body: [
        "- Всё, что вы загружаете или получаете через интеграции (тексты, фото, видео, записи звонков, данные CRM), остаётся вашим. Вы предоставляете нам право обрабатывать эти материалы исключительно для оказания услуг: хранить, преобразовывать, передавать подключённым платформам и ИИ-провайдерам по вашей команде.",
        "- Вы гарантируете, что обладаете правами на загружаемые материалы и получили согласия людей, чьи изображения, голоса, разговоры и данные обрабатываются, в том числе на запись телефонных разговоров и на рассылки.",
        "- Материалы, созданные с помощью ИИ (изображения, видео, озвучка, тексты), вы используете на свою ответственность: проверяйте их перед публикацией, соблюдайте требования платформ о маркировке ИИ-контента и не выдавайте синтетический контент за реальные события или реальных людей без их согласия.",
        "- Мы не претендуем на ваш контент и не используем его для обучения моделей или рекламы.",
      ],
    },
    {
      id: "acceptable",
      title: "6. Недопустимое использование",
      body: [
        "Запрещается использовать платформу для:",
        "- массовых незапрошенных рассылок, обмана, фишинга и выманивания данных;",
        "- нарушения авторских, смежных и иных прав, распространения запрещённого законом контента;",
        "- обхода правил и лимитов подключённых платформ, покупки или продажи аккаунтов, накрутки метрик;",
        "- попыток получить доступ к чужим проектам, данным или инфраструктуре платформы, реверс-инжиниринга и автоматизированного сбора данных из интерфейса;",
        "- обработки данных лиц младше 18 лет и особых категорий данных без законных оснований.",
        "Мы вправе приостановить или прекратить доступ при нарушении этих правил.",
      ],
    },
    {
      id: "fees",
      title: "7. Оплата",
      body: [
        "Стоимость, состав услуг и порядок оплаты определяются договором с клиентом. Расходы на сторонние сервисы (рекламные бюджеты, ИИ-провайдеры, телефония) оплачиваются в порядке, установленном договором; платформа ведёт учёт использования ИИ-функций и позволяет задавать лимиты.",
      ],
    },
    {
      id: "availability",
      title: "8. Доступность и поддержка",
      body: [
        "Мы стремимся к бесперебойной работе платформы, но не гарантируем отсутствие простоев: возможны плановые работы, сбои поставщиков инфраструктуры и ограничения внешних API. Поддержка оказывается по адресу " + LEGAL_ORG.email + " и в каналах, указанных в договоре.",
      ],
    },
    {
      id: "liability",
      title: "9. Ответственность",
      body: [
        "- Платформа предоставляется «как есть». ИИ-функции могут давать неточные результаты; решения на их основе вы принимаете самостоятельно.",
        "- Мы не отвечаем за действия подключённых платформ (блокировки аккаунтов, отклонение публикаций, изменение алгоритмов и API), за результаты рекламных кампаний и за содержание ваших материалов.",
        "- Наша совокупная ответственность перед клиентом ограничена суммой, уплаченной за услуги за три месяца, предшествующих событию, если иное не установлено законом.",
        "- Клиент возмещает нам убытки, возникшие из-за нарушения им этих условий, прав третьих лиц или правил подключённых платформ.",
      ],
    },
    {
      id: "termination",
      title: "10. Прекращение доступа и удаление данных",
      body: [
        "- Клиент может прекратить использование платформы в любой момент; проекты и учётные записи удаляются администратором в интерфейсе или по запросу.",
        "- Мы можем приостановить доступ при нарушении условий или неоплате, уведомив клиента.",
        "- После прекращения договора данные клиента удаляются в сроки, указанные в Политике конфиденциальности; подключённые интеграции отключаются, токены отзываются.",
      ],
    },
    {
      id: "ip",
      title: "11. Интеллектуальная собственность платформы",
      body: [
        "Программный код, дизайн, названия и товарные знаки платформы принадлежат нам или нашим лицензиарам. Вы получаете неисключительное, непередаваемое право использовать платформу в рамках договора. Логотипы и названия сторонних платформ (TikTok, Meta, Google и другие) принадлежат их владельцам.",
      ],
    },
    {
      id: "law",
      title: "12. Применимое право и споры",
      body: [
        `Условия регулируются законодательством ${LEGAL_ORG.jurisdiction.ru}. Споры решаются переговорами, а при недостижении согласия — в суде по месту нахождения оператора, если договором с клиентом не установлено иное.`,
      ],
    },
    {
      id: "changes",
      title: "13. Изменения условий",
      body: [`Мы можем обновлять условия. Актуальная версия публикуется по адресу ${LEGAL_ORG.site}/terms; продолжение использования платформы после изменений означает их принятие. О существенных изменениях мы уведомляем заранее.`],
    },
    {
      id: "contacts",
      title: "14. Контакты",
      body: [legalRequisites("ru")],
    },
  ],
};

const TERMS_EN: LegalDocument = {
  title: "Terms of Service",
  subtitle: "Rules for using the MarkVision AI platform for customers and their employees.",
  effective: `Effective ${dateLabel("en")}`,
  sections: [
    {
      id: "acceptance",
      title: "1. Acceptance",
      body: [
        `These terms govern the use of the ${LEGAL_ORG.brand} platform (${LEGAL_ORG.site}) provided by ${LEGAL_ORG.entity.en}, BIN ${LEGAL_ORG.bin} (“we”). By signing in to the platform or using its features you accept these terms and the Privacy Policy (${LEGAL_ORG.site}/privacy).`,
        "If you use the platform on behalf of a company, you confirm that you are authorised to accept the terms on its behalf; “customer” in this document means that company.",
      ],
    },
    {
      id: "service",
      title: "2. What the platform is",
      body: [
        "MarkVision AI is a cloud platform for marketing and sales. Depending on the enabled modules it includes:",
        "- Advertising: launching and optimising Meta and Google Ads campaigns, end-to-end analytics, a metrics table, a creative funnel.",
        "- Content: Content Factory (creative generation and AI photo sessions), AI editing and Reels videos, a content plan, the Idea Radar, auto-publishing to Instagram, TikTok, YouTube and Threads, the “TikTok connection” section.",
        "- Sales: CRM, call history, AI Sales Lead (analysis of calls and chats), AI agents for messengers, WhatsApp campaigns, lead generation.",
        "- Finance and reporting, project strategy (Marketing OS), client dashboards shared by link.",
        "The set of modules and limits is defined by the agreement with the customer. We may develop, change and retire features, notifying about material changes.",
      ],
    },
    {
      id: "accounts",
      title: "3. Accounts and team",
      body: [
        "- Accounts are created by the customer's administrator or by us at their request. You are responsible for keeping your password safe and for all activity under your account.",
        "- The administrator manages employee roles and access to modules and projects; removing an employee ends their access.",
        "- Notify us immediately about any unauthorised access to an account.",
      ],
    },
    {
      id: "integrations",
      title: "4. Connected platforms",
      body: [
        "- Integrations with Meta, Google, TikTok, Threads, Telegram, WhatsApp and telephony work through official APIs and require your consent on the respective platform's page. You connect only accounts you are entitled to manage.",
        "- By using integrations you also accept the terms of those platforms (including the TikTok Terms of Service, Meta Policies and Google API Terms) and are responsible for complying with their rules, including rules on branded content, spam and copyright.",
        "- We are not affiliated with these platforms. They may change APIs, restrict or revoke access; we are not liable for such actions but strive to adapt the platform promptly.",
        "- You can disconnect any integration in the settings; access tokens are then revoked or deleted.",
      ],
    },
    {
      id: "content",
      title: "5. Your content and data",
      body: [
        "- Everything you upload or receive through integrations (texts, photos, videos, call recordings, CRM data) remains yours. You grant us the right to process these materials solely to provide the service: to store, transform and transfer them to connected platforms and AI providers on your command.",
        "- You warrant that you hold the rights to the uploaded materials and have obtained consent from the people whose images, voices, conversations and data are processed, including consent to call recording and marketing messages.",
        "- Materials created with AI (images, videos, voice-overs, texts) are used at your own responsibility: review them before publishing, follow platform requirements on labelling AI content, and do not present synthetic content as real events or real people without their consent.",
        "- We do not claim your content and do not use it to train models or for advertising.",
      ],
    },
    {
      id: "acceptable",
      title: "6. Prohibited use",
      body: [
        "You must not use the platform for:",
        "- mass unsolicited messaging, deception, phishing or harvesting data;",
        "- infringing copyright, related or other rights, or distributing content prohibited by law;",
        "- circumventing the rules and limits of connected platforms, buying or selling accounts, inflating metrics;",
        "- attempting to access other customers' projects, data or the platform infrastructure, reverse engineering, or automated scraping of the interface;",
        "- processing data of persons under 18 or special categories of data without a legal basis.",
        "We may suspend or terminate access for violations of these rules.",
      ],
    },
    {
      id: "fees",
      title: "7. Fees",
      body: [
        "Prices, the scope of services and payment terms are defined by the agreement with the customer. Costs of third-party services (ad budgets, AI providers, telephony) are paid as set out in the agreement; the platform records AI usage and lets you set limits.",
      ],
    },
    {
      id: "availability",
      title: "8. Availability and support",
      body: [
        `We aim for uninterrupted operation but do not guarantee the absence of downtime: scheduled maintenance, infrastructure provider outages and external API limits are possible. Support is provided at ${LEGAL_ORG.email} and through the channels named in the agreement.`,
      ],
    },
    {
      id: "liability",
      title: "9. Liability",
      body: [
        "- The platform is provided “as is”. AI features may produce inaccurate results; decisions based on them are yours.",
        "- We are not liable for the actions of connected platforms (account blocks, rejected posts, changes to algorithms and APIs), for the results of ad campaigns, or for the content of your materials.",
        "- Our aggregate liability to a customer is limited to the amount paid for the service in the three months preceding the event, unless the law provides otherwise.",
        "- The customer indemnifies us against losses caused by its breach of these terms, third-party rights or the rules of connected platforms.",
      ],
    },
    {
      id: "termination",
      title: "10. Termination and data deletion",
      body: [
        "- A customer may stop using the platform at any time; projects and accounts are deleted by the administrator in the interface or on request.",
        "- We may suspend access for breach of the terms or non-payment, notifying the customer.",
        "- After the agreement ends the customer's data is deleted within the periods set in the Privacy Policy; connected integrations are disconnected and tokens revoked.",
      ],
    },
    {
      id: "ip",
      title: "11. Platform intellectual property",
      body: [
        "The platform's code, design, names and trademarks belong to us or our licensors. You receive a non-exclusive, non-transferable right to use the platform under the agreement. Logos and names of third-party platforms (TikTok, Meta, Google and others) belong to their owners.",
      ],
    },
    {
      id: "law",
      title: "12. Governing law and disputes",
      body: [
        `These terms are governed by the laws of the ${LEGAL_ORG.jurisdiction.en}. Disputes are resolved by negotiation and, failing agreement, in the court at the operator's location unless the customer agreement provides otherwise.`,
      ],
    },
    {
      id: "changes",
      title: "13. Changes to the terms",
      body: [`We may update these terms. The current version is published at ${LEGAL_ORG.site}/terms; continued use of the platform after changes means acceptance. We give advance notice of material changes.`],
    },
    {
      id: "contacts",
      title: "14. Contacts",
      body: [legalRequisites("en")],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDoc, Record<LegalLang, LegalDocument>> = {
  privacy: { ru: PRIVACY_RU, en: PRIVACY_EN },
  terms: { ru: TERMS_RU, en: TERMS_EN },
};

/** Абзац или пункт списка: «- текст» → элемент списка. */
export function splitBody(body: string[]): { kind: "p" | "li"; text: string }[] {
  return body.map((line) => (line.startsWith("- ") ? { kind: "li", text: line.slice(2) } : { kind: "p", text: line }));
}
