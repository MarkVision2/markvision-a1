/**
 * Настройки авто-запуска рекламы на кабинете.
 *
 * Поля auto_launch_enabled / launch_hour / days_of_week / target_* / creative_*
 * лежали в ad_cabinets с самого начала, но задать их было негде — крон-запуск
 * (ad-launch-scheduler) оставался недостижим из интерфейса. Здесь — разбор
 * и сборка значений формы, вынесенные из диалога, чтобы их можно было
 * проверить тестами: ошибка тут означает запуск не в тот день или не по той
 * аудитории, а это списанный бюджет.
 */
import type { AdCabinet } from "@/types/ads";

/** ISO-нумерация: 1 — понедельник, 7 — воскресенье (так же считает планировщик). */
export const WEEKDAYS: Array<{ value: number; short: string; full: string }> = [
  { value: 1, short: "Пн", full: "понедельник" },
  { value: 2, short: "Вт", full: "вторник" },
  { value: 3, short: "Ср", full: "среда" },
  { value: 4, short: "Чт", full: "четверг" },
  { value: 5, short: "Пт", full: "пятница" },
  { value: 6, short: "Сб", full: "суббота" },
  { value: 7, short: "Вс", full: "воскресенье" },
];

/** Таймзоны кабинетов проекта. Планировщик считает час запуска в них. */
export const TIMEZONES = [
  "Asia/Almaty",
  "Asia/Aqtobe",
  "Europe/Moscow",
  "Europe/Kyiv",
  "Asia/Tashkent",
  "Asia/Bishkek",
  "Asia/Baku",
  "Asia/Tbilisi",
  "Asia/Dubai",
  "UTC",
];

export interface AutoLaunchForm {
  enabled: boolean;
  launchHour: number;
  daysOfWeek: number[];
  timezone: string;
  /** Города/регионы/страны словами — воркер резолвит их через Meta /search. */
  geo: string;
  ageMin: string;
  ageMax: string;
  gender: "all" | "male" | "female";
  languages: string;
  interests: string;
  exclusions: string;
  primaryText: string;
  headline: string;
  description: string;
  /** Ссылки на креативы, по одной в строке. */
  mediaUrls: string;
}

/** Список из строки через запятую или перевод строки → массив без пустых. */
export function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Массив → строка для textarea (интересы и гео читаются через запятую). */
export function formatList(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      // Интересы могут храниться объектами {id,name} — показываем имя.
      if (item && typeof item === "object") {
        const name = (item as { name?: unknown }).name;
        if (typeof name === "string") return name.trim();
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");
}

/** Ссылки — по одной в строке: они длинные, запятая в них читается плохо. */
export function formatLines(items: unknown): string {
  return Array.isArray(items)
    ? items.filter((i): i is string => typeof i === "string" && i.trim().length > 0).join("\n")
    : "";
}

/** Кабинет → значения формы. */
export function formFromCabinet(cabinet: AdCabinet): AutoLaunchForm {
  return {
    enabled: cabinet.autoLaunchEnabled ?? false,
    launchHour: cabinet.launchHour ?? 9,
    daysOfWeek: cabinet.daysOfWeek?.length ? [...cabinet.daysOfWeek] : [1, 2, 3, 4, 5, 6, 7],
    timezone: cabinet.timezone || "Asia/Almaty",
    geo: formatList(cabinet.targetGeo),
    ageMin: cabinet.targetAgeMin != null ? String(cabinet.targetAgeMin) : "",
    ageMax: cabinet.targetAgeMax != null ? String(cabinet.targetAgeMax) : "",
    gender: cabinet.targetGender ?? "all",
    languages: formatList(cabinet.targetLanguages),
    interests: formatList(cabinet.targetInterests),
    exclusions: formatList(cabinet.targetExclusions),
    primaryText: cabinet.creativePrimaryText ?? "",
    headline: cabinet.creativeHeadline ?? "",
    description: cabinet.creativeDescription ?? "",
    mediaUrls: formatLines(cabinet.creativeMediaUrls),
  };
}

/** Значения формы → patch для updateCabinet. */
export function cabinetPatchFromForm(form: AutoLaunchForm): Partial<AdCabinet> {
  const num = (raw: string): number | undefined => {
    const value = Number(raw.trim());
    return raw.trim() && Number.isFinite(value) ? Math.round(value) : undefined;
  };
  return {
    autoLaunchEnabled: form.enabled,
    launchHour: form.launchHour,
    daysOfWeek: form.daysOfWeek,
    timezone: form.timezone,
    targetGeo: parseList(form.geo),
    targetAgeMin: num(form.ageMin),
    targetAgeMax: num(form.ageMax),
    targetGender: form.gender,
    targetLanguages: parseList(form.languages),
    targetInterests: parseList(form.interests),
    targetExclusions: parseList(form.exclusions),
    creativePrimaryText: form.primaryText.trim(),
    creativeHeadline: form.headline.trim(),
    creativeDescription: form.description.trim(),
    creativeMediaUrls: parseList(form.mediaUrls),
  };
}

/** Включение/выключение дня недели с сохранением порядка. */
export function toggleWeekday(days: number[], day: number): number[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  return next.sort((a, b) => a - b);
}

/**
 * Что мешает включить авто-запуск. Проверяем то же, что проверит воркер, —
 * лучше сказать человеку сразу, чем показать упавшее задание через сутки.
 */
export function validateAutoLaunch(form: AutoLaunchForm, cabinet: AdCabinet): string[] {
  const errors: string[] = [];
  if (!form.enabled) return errors;

  if (!form.daysOfWeek.length) errors.push("Выберите хотя бы один день недели");
  if (!cabinet.adAccountId?.trim()) errors.push("У кабинета не указан рекламный аккаунт");
  if (!cabinet.pageId?.trim()) errors.push("У кабинета не указана Facebook Page");
  if (!(Number(cabinet.dailyBudget) > 0)) errors.push("Укажите дневной бюджет кабинета");

  const hasCreative = parseList(form.mediaUrls).length > 0;
  if (!hasCreative) {
    errors.push(
      "Добавьте ссылку на креатив — иначе планировщик возьмёт последнюю картинку из галереи Контент-завода",
    );
  }

  // Цель планировщик выводит из заполненных полей кабинета — проверяем ту же
  // логику, что и inferGoal в adLaunchSchedule.ts.
  if (cabinet.whatsappNumber?.trim()) {
    // WhatsApp — ничего дополнительно не нужно.
  } else if (cabinet.leadFormId?.trim()) {
    // Лид-форма — тоже.
  } else if (!cabinet.websiteUrl?.trim() && !cabinet.landingUrl?.trim()) {
    errors.push("Для цели «Лиды с сайта» нужна ссылка на сайт в настройках кабинета");
  } else if (!cabinet.pixelId?.trim()) {
    errors.push("Для цели «Лиды с сайта» нужен пиксель в настройках кабинета");
  }

  const min = Number(form.ageMin);
  const max = Number(form.ageMax);
  if (form.ageMin && form.ageMax && Number.isFinite(min) && Number.isFinite(max) && min > max) {
    errors.push("Возраст «от» больше, чем «до»");
  }

  return errors;
}

/**
 * Строка вида «Пн, Ср, Пт в 09:00 (Asia/Almaty)».
 * Выключенный авто-запуск тоже показывает своё расписание — иначе человек
 * не видит, что именно включится, пока не включит.
 */
export function describeSchedule(form: AutoLaunchForm): string {
  const days = form.daysOfWeek.length === 7
    ? "Ежедневно"
    : WEEKDAYS.filter((d) => form.daysOfWeek.includes(d.value)).map((d) => d.short).join(", ");
  const hour = `${String(form.launchHour).padStart(2, "0")}:00`;
  const schedule = `${days || "Дни не выбраны"} в ${hour} (${form.timezone})`;
  return form.enabled ? schedule : `Выключен · ${schedule}`;
}

/**
 * Цель, которую выведет планировщик из настроек кабинета.
 * Дублирует inferGoal из supabase/functions/_lib/adLaunchSchedule.ts —
 * человек должен видеть в форме то же, что решит воркер.
 */
export function describeGoal(cabinet: AdCabinet): string {
  if (cabinet.whatsappNumber?.trim()) return "WhatsApp";
  if (cabinet.leadFormId?.trim()) return "Лид-форма Meta";
  return "Лиды с сайта";
}
