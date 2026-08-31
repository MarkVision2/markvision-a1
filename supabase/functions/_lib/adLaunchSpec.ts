// LaunchSpec — нормализованное задание на запуск рекламы и сборка тел Graph API.
//
// Раньше эта логика жила внутри launch-campaign вперемешку с разбором FormData
// и отправкой в n8n. Вынесена сюда, чтобы:
//   1) enqueue-функция и воркер строили одинаковые тела;
//   2) её можно было проверить тестами (src/test/adLaunchSpec.test.ts) —
//      ошибка в маппинге цели стоит дороже всего: объявление уходит в Meta
//      с неправильной оптимизацией и тихо сливает бюджет.
//
// Модуль чистый: никаких сетевых вызовов и импортов Deno.

export type LaunchGoal = "site-leads" | "meta-form" | "whatsapp";
export type CreativeFormat = "single" | "carousel" | "existing_post";
export type AdSetupMode = "create" | "existing";

export interface LaunchMedia {
  role: "feed" | "stories" | "carousel";
  index: number;
  /** Публичный URL: bucket ad-launch-media или галерея Контент-завода. */
  url: string;
  mime: string;
  name: string;
}

export interface LaunchSpec {
  goal: LaunchGoal;
  adAccount: string;
  cabinetName: string;
  pageId: string;
  instagramUserId: string;
  pixelId: string;
  pixelEvent: string;
  websiteUrl: string;
  whatsappNumber: string;
  leadFormId: string;
  /** Дневной бюджет в минорных единицах валюты кабинета (центы/тиын). */
  budgetCents: number;
  currency: string;
  /** Основной текст объявления. */
  text: string;
  headline: string;
  description: string;
  creativeFormat: CreativeFormat;
  adSetupMode: AdSetupMode;
  sourceInstagramMediaId: string;
  media: LaunchMedia[];
  /** Сырой ввод таргетинга — резолвится воркером через Graph /search. */
  targeting: Record<string, unknown>;
  timezone: string;
  cabinetCity: string;
  utmTemplate: string;
  /** Включать ли кампанию сразу. По умолчанию всё создаётся в PAUSED. */
  autoActivate: boolean;
  /** Имя кампании; если пусто — генерится из цели и даты. */
  campaignName: string;
}

export interface MediaAssets {
  /** image_hash в порядке следования (для карусели — порядок карточек). */
  imageHashes: string[];
  videoId: string | null;
  /** Постер для video_data — Meta требует превью у видеокреатива. */
  videoThumbUrl: string | null;
  /** Отдельный hash для сторис, если загружали второй файл. */
  storiesImageHash: string | null;
}

// ============================================================
// Метки и справочники
// ============================================================

export function goalLabel(goal: LaunchGoal | string): string {
  switch (goal) {
    case "site-leads": return "Лиды с сайта";
    case "meta-form": return "Лид-форма Meta";
    case "whatsapp": return "WhatsApp";
    default: return String(goal);
  }
}

/** Цель мастера → objective кампании Meta. */
export function objectiveFor(goal: LaunchGoal): string {
  switch (goal) {
    case "site-leads": return "OUTCOME_SALES";
    case "meta-form": return "OUTCOME_LEADS";
    case "whatsapp": return "OUTCOME_ENGAGEMENT";
  }
}

export function ctaTypeFor(goal: LaunchGoal): string {
  switch (goal) {
    case "site-leads": return "LEARN_MORE";
    case "meta-form": return "SIGN_UP";
    case "whatsapp": return "WHATSAPP_MESSAGE";
  }
}

/** Ссылка объявления. Для не-сайтовых целей Meta всё равно требует link. */
export function linkUrlFor(spec: LaunchSpec): string {
  if (spec.goal === "site-leads") {
    return spec.websiteUrl?.trim() || "https://facebook.com/";
  }
  return "https://facebook.com/";
}

export function callToActionFor(spec: LaunchSpec): Record<string, unknown> {
  const type = ctaTypeFor(spec.goal);
  if (spec.goal === "site-leads") return { type, value: { link: linkUrlFor(spec) } };
  if (spec.goal === "whatsapp") return { type, value: { app_destination: "WHATSAPP" } };
  // meta-form: ссылку на форму Meta подставляет сама по lead_form_id в ad set.
  return { type, value: {} };
}

// ============================================================
// Тела Graph API
// ============================================================

export function buildCampaignBody(spec: LaunchSpec): Record<string, unknown> {
  const name = spec.campaignName?.trim() ||
    `${goalLabel(spec.goal)} | ${new Date().toISOString().slice(0, 10)}`;
  return {
    name,
    objective: objectiveFor(spec.goal),
    special_ad_categories: [],
    // Всегда PAUSED: включение — отдельный осознанный шаг (см. autoActivate).
    status: "PAUSED",
  };
}

export function buildAdSetBody(
  spec: LaunchSpec,
  campaignId: string,
  targeting: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: `${goalLabel(spec.goal)} | adset`,
    campaign_id: campaignId,
    daily_budget: String(Math.max(100, Math.round(spec.budgetCents))),
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    billing_event: "IMPRESSIONS",
    status: "PAUSED",
    targeting,
  };

  if (spec.goal === "site-leads") {
    body.optimization_goal = "OFFSITE_CONVERSIONS";
    body.destination_type = "WEBSITE";
    body.promoted_object = {
      pixel_id: spec.pixelId,
      custom_event_type: (spec.pixelEvent || "Lead").toUpperCase(),
    };
  } else if (spec.goal === "meta-form") {
    body.optimization_goal = "LEAD_GENERATION";
    body.destination_type = "ON_AD";
    body.promoted_object = { page_id: spec.pageId };
  } else if (spec.goal === "whatsapp") {
    body.optimization_goal = "CONVERSATIONS";
    body.destination_type = "WHATSAPP";
    body.promoted_object = {
      page_id: spec.pageId,
      whatsapp_phone_number: spec.whatsappNumber,
    };
  }

  return body;
}

/**
 * Креатив. Три формы:
 *   existing — продвижение готовой публикации Instagram;
 *   video    — object_story_spec.video_data (link_data с видео Meta не примет);
 *   link     — одиночная картинка или карусель через child_attachments.
 */
export function buildCreativeBody(
  spec: LaunchSpec,
  assets: MediaAssets,
): Record<string, unknown> {
  const cta = callToActionFor(spec);
  const link = linkUrlFor(spec);
  const message = (spec.text ?? "").trim();
  const title = (spec.headline ?? "").trim() || message.slice(0, 60) || goalLabel(spec.goal);

  const base: Record<string, unknown> = { name: `creative_${Date.now()}` };
  if (spec.utmTemplate?.trim()) base.url_tags = spec.utmTemplate.trim();

  if (spec.adSetupMode === "existing" && spec.sourceInstagramMediaId) {
    return {
      ...base,
      name: `creative_existing_${Date.now()}`,
      object_id: spec.pageId,
      instagram_user_id: spec.instagramUserId,
      source_instagram_media_id: spec.sourceInstagramMediaId,
      call_to_action: cta,
    };
  }

  const storySpec: Record<string, unknown> = { page_id: spec.pageId };
  if (spec.instagramUserId) storySpec.instagram_user_id = spec.instagramUserId;

  if (assets.videoId) {
    storySpec.video_data = {
      video_id: assets.videoId,
      message,
      title,
      ...(spec.description?.trim() ? { link_description: spec.description.trim() } : {}),
      ...(assets.videoThumbUrl ? { image_url: assets.videoThumbUrl } : {}),
      call_to_action: cta,
    };
    return { ...base, object_story_spec: storySpec };
  }

  const linkData: Record<string, unknown> = {
    link,
    message,
    name: title,
    call_to_action: cta,
  };

  if (spec.creativeFormat === "carousel" && assets.imageHashes.length >= 2) {
    linkData.child_attachments = assets.imageHashes.map((hash) => ({
      link,
      image_hash: hash,
      name: title.slice(0, 40),
      call_to_action: cta,
    }));
  } else if (assets.imageHashes[0]) {
    linkData.image_hash = assets.imageHashes[0];
  }

  storySpec.link_data = linkData;
  return { ...base, object_story_spec: storySpec };
}

export function buildAdBody(
  spec: LaunchSpec,
  adsetId: string,
  creativeId: string,
): Record<string, unknown> {
  return {
    name: `${goalLabel(spec.goal)} | ad`,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: "PAUSED",
  };
}

// ============================================================
// Валидация
// ============================================================

/** Проверки, после которых задание точно не упадёт на стороне Meta по мелочи. */
export function validateLaunchSpec(spec: LaunchSpec): string[] {
  const errors: string[] = [];
  if (!spec.adAccount) errors.push("Не указан рекламный кабинет (ad_account_id)");
  if (!spec.pageId) errors.push("Не указана Facebook Page (page_id)");
  if (!Number.isFinite(spec.budgetCents) || spec.budgetCents <= 0) {
    errors.push("Дневной бюджет должен быть больше нуля");
  }
  if (spec.goal === "site-leads") {
    if (!spec.pixelId) errors.push("Для цели «Лиды с сайта» нужен pixel_id");
    if (!spec.websiteUrl?.trim()) errors.push("Для цели «Лиды с сайта» нужна ссылка на сайт");
  }
  if (spec.goal === "whatsapp" && !spec.whatsappNumber?.trim()) {
    errors.push("Для цели «WhatsApp» нужен номер WhatsApp");
  }
  if (spec.adSetupMode === "existing") {
    if (!spec.sourceInstagramMediaId) errors.push("Не выбрана публикация Instagram для продвижения");
    if (!spec.instagramUserId) {
      errors.push("Нет Instagram User ID у страницы — привяжите Instagram Business к Page");
    }
  } else if (!spec.media.length) {
    errors.push("Не приложен креатив");
  } else if (spec.creativeFormat === "carousel") {
    const carousel = spec.media.filter((m) => m.role === "carousel");
    if (carousel.length < 2) errors.push("Для карусели нужно минимум 2 изображения");
  }
  return errors;
}

// ============================================================
// Нормализация входа из мастера
// ============================================================

function str(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/**
 * Payload мастера (CreateCampaignDialog) → LaunchSpec.
 * Мастер исторически шлёт поля в нескольких вариантах написания —
 * поэтому каждое значение собирается из списка алиасов.
 */
export function normalizeLaunchPayload(
  payload: Record<string, unknown>,
  media: LaunchMedia[],
): LaunchSpec {
  const client = (payload.clientConfig ?? {}) as Record<string, unknown>;
  const cabinet = (payload.cabinet ?? {}) as Record<string, unknown>;
  const creativeDefaults = (client.creative_defaults ?? {}) as Record<string, unknown>;

  const goalRaw = str(payload.goal);
  const goal: LaunchGoal = goalRaw === "meta-form" || goalRaw === "whatsapp" || goalRaw === "site-leads"
    ? goalRaw
    : "site-leads";

  const adSetupMode: AdSetupMode = str(payload.adSetupMode, payload.ad_setup_mode) === "existing"
    ? "existing"
    : "create";
  const sourceIg = str(payload.sourceInstagramMediaId, payload.source_instagram_media_id);

  const carouselCount = media.filter((m) => m.role === "carousel").length;
  const rawFormat = str(payload.creativeFormat, payload.creative_format);
  const creativeFormat: CreativeFormat = adSetupMode === "existing"
    ? "existing_post"
    : (rawFormat === "carousel" || carouselCount >= 2 ? "carousel" : "single");

  // Бюджет: кабинет хранит daily_budget уже в минорных единицах, мастер — в $.
  const budgetCents = (() => {
    const fromClient = Number(client.daily_budget);
    if (Number.isFinite(fromClient) && fromClient > 0) return Math.round(fromClient);
    const fromPayload = Number(payload.budget);
    return Number.isFinite(fromPayload) && fromPayload > 0 ? Math.round(fromPayload * 100) : 500;
  })();

  return {
    goal,
    adAccount: "", // проставляется вызывающей стороной после нормализации act_
    cabinetName: str(cabinet.name, client.client_name, client.name),
    pageId: str(payload.pageId, client.page_id, client.pageid, cabinet.pageId),
    instagramUserId: str(
      payload.instagramUserId,
      client.instagram_actor_id,
      client.instagram_user_id,
      client.instagram_id,
      cabinet.instagramId,
    ),
    pixelId: str(payload.pixelId, client.fb_pixel_id, client.pixel_id, client.pixelid),
    pixelEvent: str(payload.pixelEvent, client.pixel_event, client.pixelevent) || "Lead",
    websiteUrl: str(payload.websiteUrl, client.website_url, client.landing_url),
    whatsappNumber: str(payload.whatsappNumber, client.whatsapp_number, client.whatsappnumber),
    leadFormId: str(payload.leadFormId, client.lead_form_id, client.leadformid),
    budgetCents,
    currency: str(payload.currency, client.currency) || "USD",
    text: str(payload.text, creativeDefaults.primary_text),
    headline: str(creativeDefaults.headline),
    description: str(creativeDefaults.description),
    creativeFormat,
    adSetupMode,
    sourceInstagramMediaId: sourceIg,
    media,
    targeting: (client.targeting ?? {}) as Record<string, unknown>,
    timezone: str((client.schedule as Record<string, unknown> | undefined)?.timezone, client.timezone) || "Asia/Almaty",
    cabinetCity: str(client.city),
    utmTemplate: str(client.utm_template),
    autoActivate: payload.autoActivate === true,
    campaignName: str(payload.campaignName),
  };
}
