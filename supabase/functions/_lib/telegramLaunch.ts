/**
 * Разбор команды запуска рекламы из сообщения Telegram.
 *
 * Порт логики ноды n8n `Set Client Config` и текстовых кусков `Parse JSON1`:
 * направление, бюджет, сайт из подписи, кодовое слово, текст объявления.
 *
 * Модуль чистый — ни сети, ни БД, поэтому весь разбор покрыт unit-тестами.
 */
import type { Destination, LaunchGoal } from "./metaAds.ts";

/** Хосты, ссылки на которые — это медиа, а не сайт клиента. */
const MEDIA_HOSTS =
  /(?:^|\.)(?:drive\.google\.com|docs\.google\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.com|fb\.watch|t\.me|telegram\.me|vk\.com)$/i;

export function extractUrls(text: unknown): string[] {
  const matches = String(text ?? "").match(/https?:\/\/[^\s<>"']+/g) ?? [];
  // Хвостовая пунктуация прилипает к ссылке в живом тексте.
  return matches.map((u) => u.replace(/[)\].,;!?]+$/, ""));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Первая ссылка, которая похожа на сайт клиента, а не на медиа-хостинг. */
export function pickWebsiteUrl(text: unknown): string | null {
  for (const url of extractUrls(text)) {
    const host = hostOf(url);
    if (host && !MEDIA_HOSTS.test(host)) return url;
  }
  return null;
}

/**
 * Направление по ключевым словам. Ссылки из текста выбрасываются до разбора:
 * URL вида instagram.com/... раньше сбивал определение на «директ».
 */
export function parseDestination(caption: unknown): Destination {
  const text = String(caption ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase()
    .trim();

  if (
    /(?<![\p{L}\p{N}])(?:лид[-\s]?форм\p{L}*|лид|форм(?:а|ы|у|е|ой)?|leadform)(?![\p{L}\p{N}])/u
      .test(text)
  ) return "leadform";

  if (/(?<![\p{L}\p{N}])(?:директ|в директ)(?![\p{L}\p{N}])/u.test(text)) {
    return "instagram";
  }

  if (
    /(?<![\p{L}\p{N}])(?:сайт|трафик|website|traffic)(?![\p{L}\p{N}])/u.test(text)
  ) return "website";

  // Явного слова нет, но в подписи есть «чистая» ссылка на сайт — значит сайт.
  if (pickWebsiteUrl(caption)) return "website";

  return "whatsapp";
}

const DESTINATION_TO_GOAL: Record<Destination, LaunchGoal> = {
  whatsapp: "whatsapp",
  website: "site-leads",
  leadform: "meta-form",
  instagram: "instagram-direct",
};

export function destinationToGoal(destination: Destination): LaunchGoal {
  return DESTINATION_TO_GOAL[destination];
}

/**
 * Дневной бюджет из подписи: «бюджет 30», «на 25$», «50 долларов».
 * Возвращает null, если суммы нет — тогда берётся бюджет кабинета.
 */
export function parseBudgetUsd(caption: unknown): number | null {
  const text = String(caption ?? "").toLowerCase();
  const patterns = [
    /(?:бюджет|budget)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:\$|usd|долл\p{L}*|бакс\p{L}*)/iu,
    // «на 30» без валюты — самый рискованный вариант: число может оказаться
    // из текста объявления («работаем на 100 процентов»). Поэтому требуем,
    // чтобы дальше не шла единица измерения или существительное.
    /(?:^|\s)на\s+(\d+(?:[.,]\d+)?)(?!\s*(?:%|процент|дн|дней|день|лет|год|мес|час|мин|шт|тг|тенге|руб|человек|мест))(?:\s|$)/iu,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (!m) continue;
    const value = Number.parseFloat(m[1].replace(",", "."));
    // Отсекаем случайные числа из текста объявления: реальный дневной бюджет
    // лежит между долларом и тысячей.
    if (Number.isFinite(value) && value >= 1 && value <= 1000) return value;
  }
  return null;
}

/** Командные слова в начале подписи — они управляют запуском, а не рекламируют. */
const LEAD_COMMAND =
  /^[\s,.;:!\-—]*(?:запусти|запускай|на\s+форму|лид[-\s]?форм\p{L}*|форм(?:а|ы|у|е|ой)?|в\s+директ|директ|на\s+сайт|на\s+трафик|трафик|сайт|карусель|карусели|видео|фото|бюджет\s*\d+)(?![\p{L}\p{N}])[\s,.;:!\-—]*/iu;

/**
 * Текст объявления из подписи: без ссылок и без командных слов.
 * Короткий остаток (меньше 25 символов) — это команда, а не текст рекламы.
 */
export function extractAdText(caption: unknown, minLength = 25): string {
  let text = String(caption ?? "").replace(/https?:\/\/\S+/g, " ");
  let previous: string;
  do {
    previous = text;
    text = text.replace(LEAD_COMMAND, "");
  } while (text !== previous);

  text = text
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length >= minLength ? text : "";
}

/**
 * Кодовое слово, которое просят написать в WhatsApp: «напишите +»,
 * «напишите слово СТАРТ», «отправьте "ЦЕНА"». Подставляется в wa.me?text=.
 */
export function extractCodeWord(...sources: unknown[]): string {
  const text = sources.map((s) => String(s ?? "")).join(" ");
  if (!text.trim()) return "";

  const ask = "(?:напиш[иеё]те?|пиш[иеё]те?|став[ья]те?|поставь(?:те)?|жм[иё]те?|отправ[ья]те?)";

  // Границы слова задаём через lookaround, а не \b: \b опирается на ASCII и
  // для кириллицы не срабатывает — в n8n эта ветка молча не работала.
  if (
    new RegExp(`${ask}\\s*[«"']?\\s*\\+`, "iu").test(text) ||
    /(?<![\p{L}\p{N}])плюс(ик)?(?![\p{L}\p{N}])/iu.test(text)
  ) {
    return "+";
  }
  const word = text.match(new RegExp(`${ask}\\s+слово\\s+[«"']?([A-Za-zА-Яа-яЁё0-9]{2,15})`, "iu"));
  if (word) return word[1].toUpperCase();

  const quoted = text.match(new RegExp(`${ask}\\s*[«"']([^«»"']{1,15})[»"']`, "iu"));
  if (quoted) return quoted[1].trim();

  const caps = text.match(new RegExp(`${ask}\\s+([А-ЯЁ]{3,15}|[A-Z]{3,15})(?![\\p{L}])`, "u"));
  if (caps) return caps[1];

  return "";
}

/**
 * Медиа без подписи — не запускаем молча. Исключение: фото из альбома,
 * где подпись висит на одном снимке группы, а остальные приходят пустыми.
 */
export function needsDirectionPrompt(args: {
  caption: unknown;
  hasMedia: boolean;
  mediaGroupId?: string | null;
}): boolean {
  const empty = String(args.caption ?? "").trim() === "";
  return empty && args.hasMedia && !args.mediaGroupId;
}

/* ────────────────────────────── сайт из подписи ──────────────────────── */

export type WebsiteStatus = "no_whitelist" | "ok" | "fallback_default";

export interface WebsiteResolution {
  url: string | null;
  status: WebsiteStatus;
  message: string | null;
}

/**
 * Какой сайт уйдёт в объявление.
 *
 * Ссылку из подписи принимаем, только если её домен разрешён кабинету —
 * иначе реклама увела бы трафик на чужой домен. Если список разрешённых
 * пуст, доверяем подписи как раньше; если домен чужой — молча падаем на
 * сайт кабинета и говорим об этом в ответе боту.
 */
export function resolveWebsite(args: {
  fromCaption?: string | null;
  cabinetDefault?: string | null;
  allowed?: Array<{ url: string; label?: string | null; isDefault?: boolean | null }>;
}): WebsiteResolution {
  const candidate = String(args.fromCaption ?? "").trim() || null;
  const cabinetDefault = String(args.cabinetDefault ?? "").trim() || null;
  const allowed = args.allowed ?? [];

  if (allowed.length === 0) {
    return {
      url: candidate ?? cabinetDefault,
      status: "no_whitelist",
      message: null,
    };
  }

  const fallback = allowed.find((w) => w.isDefault) ?? allowed[0];
  const fallbackUrl = cabinetDefault ?? fallback.url;

  if (!candidate) {
    return { url: fallbackUrl, status: "fallback_default", message: null };
  }

  const candidateHost = hostOf(candidate);
  // Домен из настроек кабинета разрешён всегда — его задавал администратор.
  const allowedHosts = new Set(
    [...allowed.map((w) => w.url), cabinetDefault]
      .map((u) => (u ? hostOf(u) : null))
      .filter((h): h is string => !!h),
  );

  if (candidateHost && allowedHosts.has(candidateHost)) {
    return { url: candidate, status: "ok", message: null };
  }

  return {
    url: fallbackUrl,
    status: "fallback_default",
    message: `Домен ${candidateHost ?? candidate} не привязан к проекту. ` +
      `Запускаю на ${fallback.label || fallbackUrl}.`,
  };
}

/* ────────────────────────────── итоговый разбор ──────────────────────── */

export interface ParsedCommand {
  destination: Destination;
  goal: LaunchGoal;
  budgetUsd: number | null;
  adText: string;
  codeWord: string;
  websiteFromCaption: string | null;
}

/** Полный разбор подписи к медиа — то, с чем дальше работает очередь запусков. */
export function parseLaunchCommand(caption: unknown): ParsedCommand {
  const destination = parseDestination(caption);
  return {
    destination,
    goal: destinationToGoal(destination),
    budgetUsd: parseBudgetUsd(caption),
    adText: extractAdText(caption),
    codeWord: extractCodeWord(caption),
    websiteFromCaption: pickWebsiteUrl(caption),
  };
}
