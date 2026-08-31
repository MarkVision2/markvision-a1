// Чистая логика авто-запуска по расписанию кабинета.
//
// Вынесена из ad-launch-scheduler отдельным модулем, потому что решение
// «пора ли запускать» зависит от таймзоны кабинета, а ошибка на границе
// суток означает запуск не в тот день и списанный бюджет в выходной.
// Без remote-импортов — покрыто src/test/adLaunchScheduler.test.ts.

import { normalizeAdAccount } from "./metaGraph.ts";
import { allowedMediaHosts, isAllowedMediaUrl } from "./adLaunchMedia.ts";
import type { LaunchMedia, LaunchSpec } from "./adLaunchSpec.ts";

export interface CabinetRow {
  id: string;
  name: string;
  project_id: string | null;
  ad_account_id: string | null;
  page_id: string | null;
  instagram_id: string | null;
  pixel_id: string | null;
  pixel_event: string | null;
  website_url: string | null;
  landing_url: string | null;
  whatsapp_number: string | null;
  lead_form_id: string | null;
  daily_budget: number | null;
  currency: string | null;
  city: string | null;
  timezone: string | null;
  launch_hour: number;
  days_of_week: number[];
  utm_template: string | null;
  creative_headline: string | null;
  creative_primary_text: string | null;
  creative_description: string | null;
  creative_media_urls: string[] | null;
  target_geo: string[] | null;
  target_age_min: number | null;
  target_age_max: number | null;
  target_gender: string | null;
  target_languages: string[] | null;
  target_interests: unknown[] | null;
  target_exclusions: unknown[] | null;
}

/**
 * Локальные час/день недели/дата кабинета.
 * Intl вместо ручной арифметики: таймзоны кабинетов разные, а перевод часов
 * и границы суток руками — источник ошибок «запустилось не в тот день».
 */
export function localParts(now: Date, timeZone: string): { hour: number; isoDow: number; date: string } {
  const tz = timeZone || "UTC";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    // "24" встречается в некоторых движках для полуночи — нормализуем в 0.
    hour: Number(parts.hour) % 24,
    isoDow: dowMap[parts.weekday] ?? 1,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Пора ли запускать: совпал час и день недели разрешён. */
export function isDue(
  now: Date,
  timezone: string,
  launchHour: number,
  daysOfWeek: number[],
): boolean {
  const { hour, isoDow } = localParts(now, timezone);
  if (hour !== launchHour) return false;
  const days = daysOfWeek?.length ? daysOfWeek : [1, 2, 3, 4, 5, 6, 7];
  return days.includes(isoDow);
}

/** Цель кабинета выводится из того, что в нём заполнено. */
export function inferGoal(cab: CabinetRow): LaunchSpec["goal"] {
  if (cab.whatsapp_number?.trim()) return "whatsapp";
  if (cab.lead_form_id?.trim()) return "meta-form";
  return "site-leads";
}

/**
 * Ссылки из настроек кабинета → медиа задания.
 * Хосты фильтруются здесь же: creative_media_urls заполняет человек через
 * диалог авто-запуска, а качает их потом сервер — чужой адрес до fetch
 * доходить не должен.
 */
export function mediaFromUrls(
  urls: string[] | null | undefined,
  extraHosts?: string | null,
): LaunchMedia[] {
  const allowed = allowedMediaHosts(extraHosts);
  const list = (urls ?? [])
    .filter((u) => typeof u === "string" && u.trim())
    .filter((u) => isAllowedMediaUrl(u, allowed));
  return list.map((url, index) => {
    const isVideo = /\.(mp4|mov|m4v)(\?|$)/i.test(url);
    return {
      role: (list.length > 1 ? "carousel" : "feed") as LaunchMedia["role"],
      index,
      url: url.trim(),
      mime: isVideo ? "video/mp4" : "image/jpeg",
      name: `auto-${index}.${isVideo ? "mp4" : "jpg"}`,
    };
  });
}

export function specFromCabinet(cab: CabinetRow, media: LaunchMedia[]): LaunchSpec {
  const goal = inferGoal(cab);
  return {
    goal,
    adAccount: normalizeAdAccount(cab.ad_account_id ?? ""),
    cabinetName: cab.name ?? "",
    pageId: cab.page_id ?? "",
    instagramUserId: cab.instagram_id ?? "",
    pixelId: cab.pixel_id ?? "",
    pixelEvent: cab.pixel_event || "Lead",
    websiteUrl: cab.website_url || cab.landing_url || "",
    whatsappNumber: cab.whatsapp_number ?? "",
    leadFormId: cab.lead_form_id ?? "",
    // daily_budget кабинета уже в минорных единицах валюты.
    budgetCents: Math.round(Number(cab.daily_budget) || 0),
    currency: cab.currency || "USD",
    text: cab.creative_primary_text ?? "",
    headline: cab.creative_headline ?? "",
    description: cab.creative_description ?? "",
    creativeFormat: media.length >= 2 ? "carousel" : "single",
    adSetupMode: "create",
    sourceInstagramMediaId: "",
    media,
    targeting: {
      geo: cab.target_geo ?? [],
      age_min: cab.target_age_min,
      age_max: cab.target_age_max,
      gender: cab.target_gender ?? "all",
      languages: cab.target_languages ?? [],
      interests: cab.target_interests ?? [],
      exclusions: cab.target_exclusions ?? [],
    },
    timezone: cab.timezone || "Asia/Almaty",
    cabinetCity: cab.city ?? "",
    utmTemplate: cab.utm_template ?? "",
    // Авто-запуск тоже создаёт кампанию на паузе: включение остаётся
    // решением человека, иначе крон однажды сольёт бюджет молча.
    autoActivate: false,
    campaignName: `${cab.name} | авто | ${new Date().toISOString().slice(0, 10)}`,
  };
}
