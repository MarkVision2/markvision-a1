/**
 * Сборка тел запросов к Meta Marketing API — порт логики ноды n8n `Parse JSON1`.
 *
 * Модуль СПЕЦИАЛЬНО чистый: никаких Deno API, сети и БД. Всё, что ходит наружу
 * (резолв гео, создание сущностей), живёт в metaGraph.ts и в воркере.
 * Благодаря этому тела запросов покрываются обычными unit-тестами из src/test.
 *
 * Отличие от n8n-версии: дневной бюджет НЕ режется до $5. В `Parse JSON1` стоял
 * `Math.min(бюджет, 500)` — забытый предохранитель, из-за которого кампания с
 * бюджетом $50 откручивалась на $5.
 */

export const META_API_VERSION = "v22.0";

/** Цели, которые предлагает мастер запуска на сайте. */
export type LaunchGoal = "whatsapp" | "site-leads" | "meta-form" | "instagram-direct";

/** Как собран креатив. `existing_post` — продвижение готовой публикации Instagram. */
export type CreativeFormat = "single" | "carousel" | "video" | "existing_post";

export interface CabinetConfig {
  clientName?: string | null;
  adAccountId: string;
  pageId?: string | null;
  instagramUserId?: string | null;
  pixelId?: string | null;
  pixelEvent?: string | null;
  websiteUrl?: string | null;
  whatsappNumber?: string | null;
  leadFormId?: string | null;
  /** Есть подключённый WhatsApp Business Account — тогда доступна цель CONVERSATIONS. */
  wabaPhoneNumberId?: string | null;
  timezone?: string | null;
}

export interface CreativeInput {
  format: CreativeFormat;
  /** Один image_hash для single. */
  imageHash?: string | null;
  /** Упорядоченные image_hash для карусели. */
  imageHashes?: string[];
  /** id видео в Meta после /advideos. */
  videoId?: string | null;
  videoThumbUrl?: string | null;
  /** id публикации Instagram для режима «продвинуть пост». */
  sourceInstagramMediaId?: string | null;
}

export interface LaunchInput {
  goal: LaunchGoal;
  /** Дневной бюджет в долларах, как его ввёл менеджер. */
  budgetUsd: number;
  text: string;
  headline?: string | null;
  /** Кодовое слово: подставляется в wa.me?text= и в autofill приветствия. */
  codeWord?: string | null;
  /** Название услуги/оффера для имён группы и объявления. */
  service?: string | null;
  creative: CreativeInput;
}

/* ────────────────────────────── примитивы ────────────────────────────── */

const EMPTY_VALUES = new Set(["", "none", "null", "undefined", "-"]);

/** Отсекает мусорные значения URL, которые нельзя отправлять в Meta. */
export function cleanUrl(value: unknown): string {
  const s = String(value ?? "").trim();
  return EMPTY_VALUES.has(s.toLowerCase()) ? "" : s;
}

/** `123` / `act_123` → `act_123`. */
export function normalizeActId(raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const digits = t.replace(/^act_/i, "").replace(/\D/g, "");
  return digits ? `act_${digits}` : "";
}

/**
 * Дневной бюджет в МИНОРНЫХ единицах валюты рекламного аккаунта.
 *
 * Meta принимает `daily_budget` именно так: для счёта в тенге «5000» — это
 * 50 ₸, а не 50 $. Раньше здесь было жёсткое умножение на 100 «в центы», что
 * для аккаунтов не в долларах давало бюджет не той величины. Валюта и её
 * дробность приходят из самого кабинета (`kind=ad_account`).
 *
 * `minorUnits` — 100 для обычных валют и 1 для валют без копеек (JPY, KRW…).
 */
export function dailyBudgetMinor(
  amount: unknown,
  minorUnits = 100,
  fallbackMinor = 5 * minorUnits,
): number {
  const units = minorUnits === 1 ? 1 : 100;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return Math.round(fallbackMinor);
  // Меньше одной единицы валюты Meta не примет ни при каком аккаунте.
  return Math.max(units, Math.round(n * units));
}

/** Ссылка на чат WhatsApp с предзаполненным сообщением. */
export function whatsappLink(number: unknown, prefill?: string | null): string {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const text = String(prefill ?? "").trim();
  return text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`;
}

/**
 * Заголовок и название услуги из текста объявления.
 *
 * В мастере запуска этих полей нет — менеджер пишет только текст. В n8n их
 * придумывал AI; здесь берём первую содержательную фразу, чтобы в Ads Manager
 * и в отчётах кампании отличались друг от друга, а не назывались «Реклама».
 */
export function deriveHeadline(text: unknown, maxLength = 40): string {
  const raw = String(text ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>]+/g, " ")
    // Эмодзи и прочие символы вне текста заголовку не нужны.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, " ")
    // Схлопываем пробелы, но переводы строк сохраняем — по ним режем первым делом.
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
  if (!raw) return "";

  // Первая строка, затем первое предложение внутри неё.
  const firstLine = raw.split("\n")[0]?.trim() || raw;
  const sentence = firstLine.split(/(?<=[.!?])\s+/)[0]?.trim() ?? firstLine;
  const source = sentence.length > 0 ? sentence : firstLine;
  if (source.length <= maxLength) return source.replace(/[.,;:!?\s]+$/, "");

  // Режем по границе слова, чтобы не обрывать посередине.
  const cut = source.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[.,;:!?\s]+$/, "");
}

/* ────────────────────────────── назначение ───────────────────────────── */

export type Destination = "whatsapp" | "website" | "leadform" | "instagram";

/**
 * Цель мастера → назначение объявления, с той же защитой, что стояла в n8n:
 * нет своего номера WhatsApp, но есть лид-форма → уходим на лид-форму, иначе
 * Meta вернёт #1487246 «This WhatsApp phone number is not linked to your account».
 */
export function resolveDestination(
  goal: LaunchGoal,
  cabinet: CabinetConfig,
): Destination {
  if (goal === "meta-form") return "leadform";
  if (goal === "site-leads") return "website";
  if (goal === "instagram-direct") return "instagram";
  if (!cleanUrl(cabinet.whatsappNumber) && cleanUrl(cabinet.leadFormId)) {
    return "leadform";
  }
  return "whatsapp";
}

export interface LinkContext {
  destination: Destination;
  finalLink: string;
  leadFormId: string;
}

/** Ссылка объявления и id лид-формы — общий контекст для CTA и креатива. */
export function buildLinkContext(
  input: LaunchInput,
  cabinet: CabinetConfig,
): LinkContext {
  const destination = resolveDestination(input.goal, cabinet);
  const leadFormId = cleanUrl(cabinet.leadFormId);

  if (destination === "leadform") {
    // Meta требует непустую ссылку даже для лид-формы — это официальный плейсхолдер.
    return { destination, finalLink: "http://fb.me/", leadFormId };
  }
  if (destination === "instagram") {
    return { destination, finalLink: "https://www.instagram.com/", leadFormId };
  }
  if (destination === "website") {
    const site = cleanUrl(cabinet.websiteUrl);
    const fallback = cleanUrl(cabinet.pageId)
      ? `https://facebook.com/${cleanUrl(cabinet.pageId)}`
      : "https://facebook.com/";
    return { destination, finalLink: site || fallback, leadFormId };
  }
  return {
    destination,
    finalLink: whatsappLink(cabinet.whatsappNumber, input.codeWord),
    leadFormId,
  };
}

/**
 * Кнопка объявления. Click-to-WhatsApp требует именно WHATSAPP_MESSAGE
 * с `app_destination`, иначе Meta отвечает #1487891 — номер берётся
 * из promoted_object группы, а не из кнопки.
 */
export function buildCallToAction(
  ctx: LinkContext,
): { type: string; value: Record<string, unknown> } {
  if (ctx.destination === "leadform" && ctx.leadFormId) {
    return { type: "LEARN_MORE", value: { lead_gen_form_id: ctx.leadFormId } };
  }
  if (ctx.destination === "website") {
    return { type: "LEARN_MORE", value: { link: ctx.finalLink } };
  }
  if (ctx.destination === "instagram") {
    return { type: "INSTAGRAM_MESSAGE", value: { link: ctx.finalLink } };
  }
  return { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } };
}

/* ────────────────────────────── имена ────────────────────────────────── */

export const GOAL_LABELS: Record<Destination, string> = {
  leadform: "Лид-форма",
  website: "Сайт",
  whatsapp: "WhatsApp",
  instagram: "Инстаграм",
};

export function formatLabel(format: CreativeFormat): string {
  if (format === "video") return "Видео";
  if (format === "carousel") return "Карусель";
  if (format === "existing_post") return "Пост";
  return "Фото";
}

/** ддММ по часовому поясу кабинета. */
export function dateLabel(now: Date, timeZone = "Asia/Almaty"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}${get("month")}`;
}

/**
 * Короткий бренд из имени кабинета: часть после «—», «–» или «|».
 * «Тойота Центр Павлодар — ТОЙОТА» → «ТОЙОТА». Разные бренды одного кабинета
 * дают разные имена кампаний, а значит и разные группы в отчётах.
 */
export function clientSlug(clientName: unknown): string {
  const raw = String(clientName ?? "").trim() || "AI";
  const tail = raw.split(/\s*[—–|]\s*/).pop() || raw;
  return tail.replace(/["«»]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "AI";
}

export interface LaunchNames {
  campaign: string;
  adSet: string;
  ad: string;
}

/**
 * Имя кампании стабильное (без услуги) — все запуски одного дня с одной целью
 * сходятся в одну кампанию. Имя группы и объявления содержит услугу и индекс
 * группы, поэтому уникально внутри кампании.
 *
 * Суффикс «AI» сохранён намеренно: ежедневный оптимизатор отбирает кампании
 * по нему, и переименование вывело бы запуски из-под автопаузы.
 */
export function buildNames(args: {
  clientName?: string | null;
  service?: string | null;
  format: CreativeFormat;
  destination: Destination;
  now: Date;
  timeZone?: string | null;
  groupIndex: number;
}): LaunchNames {
  const tz = args.timeZone || "Asia/Almaty";
  const slug = clientSlug(args.clientName);
  const service = String(args.service ?? "").replace(/["«»]/g, "")
    .replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Реклама";
  const fmt = formatLabel(args.format);
  const goal = GOAL_LABELS[args.destination];
  const date = dateLabel(args.now, tz);

  const campaign = `${slug} | ${fmt} | ${goal} | ${date} | AI`;
  const base = `${slug} | ${service} | ${fmt} | ${date} | AI`;
  const suffix = ` | g${Math.max(1, args.groupIndex)}`;
  return { campaign, adSet: base + suffix, ad: base + suffix };
}

/** Ключ консолидации: одна кампания на кабинет + дату + цель + objective. */
export function campaignGroupKey(args: {
  adAccountId: string;
  now: Date;
  timeZone?: string | null;
  destination: Destination;
  objective: string;
}): { adAccountId: string; dateKey: string; goal: string; objective: string } {
  const tz = args.timeZone || "Asia/Almaty";
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(args.now);
  return {
    adAccountId: normalizeActId(args.adAccountId),
    dateKey,
    goal: args.destination,
    objective: args.objective,
  };
}

/* ────────────────────────────── время старта ─────────────────────────── */

/** Смещение часового пояса в минутах для конкретного момента. */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}${mm}`;
}

/**
 * Время старта группы, как в n8n: до полудня по часовому поясу кабинета —
 * через 2 минуты, после — в 00:00 следующих суток. Формат Meta:
 * `2026-08-31T09:12:00+0500`.
 */
export function resolveStartTime(now: Date, timeZone = "Asia/Almaty"): string {
  const off = timeZoneOffsetMinutes(now, timeZone);
  const local = new Date(now.getTime() + off * 60_000);

  const startLocal = local.getUTCHours() < 12
    ? new Date(local.getTime() + 2 * 60_000)
    : new Date(Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + 1,
      0,
      0,
      0,
    ));

  // Пересчитываем смещение уже для момента старта: если пояс переводит часы,
  // подпись должна соответствовать реальному моменту, а не текущему.
  const instant = new Date(startLocal.getTime() - off * 60_000);
  const off2 = timeZoneOffsetMinutes(instant, timeZone);
  const shown = new Date(instant.getTime() + off2 * 60_000);

  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${shown.getUTCFullYear()}-${p(shown.getUTCMonth() + 1)}-${p(shown.getUTCDate())}` +
    `T${p(shown.getUTCHours())}:${p(shown.getUTCMinutes())}:${p(shown.getUTCSeconds())}` +
    formatOffset(off2);
}

/* ────────────────────────────── тела запросов ────────────────────────── */

/** Событие пикселя → значение custom_event_type для promoted_object. */
export function pixelEventType(raw: unknown): string {
  const first = String(raw ?? "").split(",")[0].trim().toUpperCase();
  return first || "CONTACT";
}

export function buildCampaignObjective(
  destination: Destination,
  cabinet: CabinetConfig,
): string {
  if (destination === "leadform") return "OUTCOME_LEADS";
  if (destination === "instagram") return "OUTCOME_ENGAGEMENT";
  if (destination === "website") {
    return pixelEventType(cabinet.pixelEvent) === "PURCHASE"
      ? "OUTCOME_SALES"
      : "OUTCOME_LEADS";
  }
  return cleanUrl(cabinet.wabaPhoneNumberId) ? "OUTCOME_ENGAGEMENT" : "OUTCOME_TRAFFIC";
}

export function buildCampaignBody(args: {
  name: string;
  destination: Destination;
  cabinet: CabinetConfig;
}): Record<string, unknown> {
  return {
    name: args.name,
    objective: buildCampaignObjective(args.destination, args.cabinet),
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
    status: "ACTIVE",
  };
}

/** Таргетинг: гео плюс Advantage+ аудитория (возраст при ней Meta не принимает). */
export function buildTargeting(
  geoLocations: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const geo = geoLocations && Object.keys(geoLocations).length > 0
    ? geoLocations
    : { countries: ["KZ"], location_types: ["home", "recent"] };
  return { geo_locations: geo, targeting_automation: { advantage_audience: 1 } };
}

export function buildAdSetBody(args: {
  name: string;
  campaignId?: string | null;
  destination: Destination;
  cabinet: CabinetConfig;
  /** Сумма в единицах валюты кабинета, как её ввёл менеджер. */
  budgetUsd: number;
  /** Дробность валюты кабинета: 100 обычно, 1 для валют без копеек. */
  minorUnits?: number;
  targeting: Record<string, unknown>;
  startTime: string;
}): Record<string, unknown> {
  const { destination, cabinet } = args;
  const hasWaba = !!cleanUrl(cabinet.wabaPhoneNumberId);

  const optimizationGoal = destination === "website"
    ? "OFFSITE_CONVERSIONS"
    : destination === "leadform"
    ? "LEAD_GENERATION"
    : destination === "instagram"
    ? "LINK_CLICKS"
    : hasWaba
    ? "CONVERSATIONS"
    : "LINK_CLICKS";

  const destinationType = destination === "website"
    ? "WEBSITE"
    : destination === "leadform"
    ? "ON_AD"
    : destination === "instagram"
    ? "INSTAGRAM_DIRECT"
    : hasWaba
    ? "WHATSAPP"
    : "WEBSITE";

  const promotedObject: Record<string, unknown> = destination === "instagram"
    ? { page_id: cleanUrl(cabinet.pageId) }
    : destination === "website"
    ? {
      pixel_id: cleanUrl(cabinet.pixelId),
      custom_event_type: pixelEventType(cabinet.pixelEvent),
    }
    : destination === "leadform"
    ? { page_id: cleanUrl(cabinet.pageId) }
    : hasWaba
    ? {
      page_id: cleanUrl(cabinet.pageId),
      whatsapp_phone_number: cleanUrl(cabinet.whatsappNumber),
    }
    : { page_id: cleanUrl(cabinet.pageId) };

  return {
    name: args.name,
    ...(args.campaignId ? { campaign_id: args.campaignId } : {}),
    daily_budget: String(dailyBudgetMinor(args.budgetUsd, args.minorUnits ?? 100)),
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    billing_event: "IMPRESSIONS",
    optimization_goal: optimizationGoal,
    destination_type: destinationType,
    promoted_object: promotedObject,
    ...(destination === "website"
      ? {
        attribution_spec: [
          { event_type: "CLICK_THROUGH", window_days: 7 },
          { event_type: "VIEW_THROUGH", window_days: 1 },
        ],
      }
      : {}),
    start_time: args.startTime,
    targeting: args.targeting,
    status: "ACTIVE",
  };
}

/**
 * Метки UTM для объявлений на сайт: Meta подставит реальные имена кампании и
 * объявления при каждом клике, поэтому в аналитике видно название, а не id.
 */
export const URL_TAGS =
  "utm_source=meta&utm_campaign={{campaign.name}}&utm_content={{ad.id}}_{{ad.name}}";

export function buildCreativeBody(args: {
  name: string;
  input: LaunchInput;
  cabinet: CabinetConfig;
  ctx: LinkContext;
}): Record<string, unknown> {
  const { input, cabinet, ctx } = args;
  const cta = buildCallToAction(ctx);
  const pageId = cleanUrl(cabinet.pageId);
  const igUser = cleanUrl(cabinet.instagramUserId);
  const headline = String(input.headline ?? "").trim() || "Подробнее";
  const message = String(input.text ?? "");
  const creative = input.creative;

  // Продвижение существующей публикации Instagram: свой пост не собираем,
  // Meta рисует кнопку поверх оригинала.
  if (creative.format === "existing_post" && creative.sourceInstagramMediaId) {
    return {
      name: args.name,
      object_id: pageId,
      source_instagram_media_id: String(creative.sourceInstagramMediaId),
      ...(igUser ? { instagram_user_id: igUser } : {}),
      call_to_action: cta,
    };
  }

  let storySpec: Record<string, unknown>;

  if (creative.format === "video" && creative.videoId) {
    storySpec = {
      page_id: pageId,
      ...(igUser ? { instagram_user_id: igUser } : {}),
      video_data: {
        video_id: String(creative.videoId),
        message,
        title: headline,
        call_to_action: cta,
        ...(creative.videoThumbUrl ? { image_url: creative.videoThumbUrl } : {}),
      },
    };
  } else if (creative.format === "carousel" && (creative.imageHashes?.length ?? 0) >= 2) {
    storySpec = {
      page_id: pageId,
      ...(igUser ? { instagram_user_id: igUser } : {}),
      link_data: {
        link: ctx.finalLink,
        message,
        name: headline,
        child_attachments: (creative.imageHashes ?? []).map((hash) => ({
          link: ctx.finalLink,
          name: headline,
          image_hash: hash,
          call_to_action: cta,
        })),
      },
    };
  } else {
    storySpec = {
      page_id: pageId,
      ...(igUser ? { instagram_user_id: igUser } : {}),
      link_data: {
        link: ctx.finalLink,
        message,
        name: headline,
        call_to_action: cta,
        ...(creative.imageHash ? { image_hash: creative.imageHash } : {}),
      },
    };
  }

  const body: Record<string, unknown> = {
    name: args.name,
    object_story_spec: storySpec,
  };
  if (ctx.destination === "website") body.url_tags = URL_TAGS;
  return body;
}

export function buildAdBody(args: {
  name: string;
  adSetId: string;
  creativeId: string;
  cabinet: CabinetConfig;
}): Record<string, unknown> {
  const pixelId = cleanUrl(args.cabinet.pixelId);
  return {
    name: args.name,
    adset_id: args.adSetId,
    creative: { creative_id: args.creativeId },
    status: "ACTIVE",
    ...(pixelId
      ? {
        tracking_specs: [
          { "action.type": ["offsite_conversion"], fb_pixel: [pixelId] },
        ],
      }
      : {}),
  };
}

/* ────────────────────────────── валидация ────────────────────────────── */

/**
 * Проверки, которые дешевле сделать до первого обращения к Meta: пустой
 * page_id или отсутствующий пиксель Meta отвергнет уже после создания
 * кампании, и в кабинете останется мусор.
 */
export function validateLaunch(
  input: LaunchInput,
  cabinet: CabinetConfig,
): string[] {
  const errors: string[] = [];
  if (!normalizeActId(cabinet.adAccountId)) {
    errors.push("У кабинета не заполнен рекламный аккаунт (ad_account_id).");
  }
  if (!cleanUrl(cabinet.pageId)) {
    errors.push("У кабинета не выбрана страница Facebook.");
  }

  const destination = resolveDestination(input.goal, cabinet);
  if (destination === "website" && !cleanUrl(cabinet.pixelId)) {
    errors.push("Для цели «Лиды с сайта» нужен пиксель Meta.");
  }
  if (destination === "website" && !cleanUrl(cabinet.websiteUrl)) {
    errors.push("Для цели «Лиды с сайта» нужен адрес сайта.");
  }
  if (destination === "leadform" && !cleanUrl(cabinet.leadFormId)) {
    errors.push("Для цели «Лид-форма Meta» нужно выбрать форму.");
  }
  if (destination === "whatsapp" && !cleanUrl(cabinet.whatsappNumber)) {
    errors.push("Для цели «WhatsApp» нужен номер WhatsApp.");
  }
  if (destination === "instagram" && !cleanUrl(cabinet.instagramUserId)) {
    errors.push("Для цели «Инстаграм» нужен привязанный аккаунт Instagram.");
  }

  const c = input.creative;
  if (c.format === "existing_post" && !cleanUrl(c.sourceInstagramMediaId)) {
    errors.push("Не выбрана публикация Instagram для продвижения.");
  }
  if (c.format === "carousel" && (c.imageHashes?.length ?? 0) < 2) {
    errors.push("Для карусели нужно минимум два изображения.");
  }
  if (c.format === "video" && !cleanUrl(c.videoId)) {
    errors.push("Видео не загрузилось в Meta.");
  }
  if (c.format === "single" && !cleanUrl(c.imageHash)) {
    errors.push("Не загружено изображение объявления.");
  }
  if (!Number.isFinite(Number(input.budgetUsd)) || Number(input.budgetUsd) <= 0) {
    errors.push("Дневной бюджет должен быть больше нуля.");
  }
  return errors;
}
