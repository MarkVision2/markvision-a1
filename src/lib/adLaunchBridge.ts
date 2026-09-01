/**
 * Мост «Контент-завод → реклама».
 *
 * Раньше сгенерённый баннер скачивали из галереи руками и руками же грузили
 * в мастер запуска. Здесь — общие хелперы, которые переносят креатив по ссылке:
 * галерея строит URL раздела «Реклама», страница Ads его разбирает, а мастер
 * подтягивает картинку в обычный File — дальше работает весь существующий
 * путь (кроп, форматы, валидация), ничего дублировать не нужно.
 */

/** Ключ query-параметра со ссылкой на креатив. */
export const CREATIVE_PARAM = "creative";

/** Ссылка на раздел «Реклама» с предзаполненным креативом. */
export function buildAdsLaunchUrl(imageUrl: string): string {
  const clean = (imageUrl ?? "").trim();
  const params = new URLSearchParams({ tab: "campaigns" });
  if (clean) params.set(CREATIVE_PARAM, clean);
  return `/ads?${params.toString()}`;
}

/**
 * Разбор параметра. Принимаем только http(s): подставленный в адресную строку
 * `javascript:` или `data:` не должен доехать до fetch и до Meta.
 */
export function parseCreativeParam(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Имя файла из URL — Meta показывает его в списке креативов кабинета. */
export function fileNameFromUrl(url: string, fallback = "creative.jpg"): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop() ?? "";
    const clean = decodeURIComponent(last).replace(/[^\w.-]+/g, "_");
    if (!clean) return fallback;
    return /\.[a-z0-9]{2,5}$/i.test(clean) ? clean : `${clean}.jpg`;
  } catch {
    return fallback;
  }
}

/**
 * Скачивание креатива по ссылке в File для мастера запуска.
 * Возвращает null, если ссылка не отдалась (CORS, 404) — вызывающий код
 * показывает тост и оставляет мастер пустым, а не падает.
 */
export async function fetchCreativeAsFile(url: string): Promise<File | null> {
  const safe = parseCreativeParam(url);
  if (!safe) return null;
  try {
    const res = await fetch(safe, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    const type = blob.type || "image/jpeg";
    return new File([blob], fileNameFromUrl(safe), { type });
  } catch {
    return null;
  }
}
