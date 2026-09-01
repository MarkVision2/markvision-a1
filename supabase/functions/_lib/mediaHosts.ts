// Allowlist хостов, с которых сервер готов скачивать медиа.
//
// Воркер запуска делает server-side fetch по каждой ссылке из задания и
// отправляет полученные байты в Meta как изображение объявления. Если ссылку
// в задание кладёт клиент (payload.creativeUrls из мастера или
// creative_media_urls из настроек кабинета), то без проверки это готовый SSRF:
// менеджер подставляет внутренний адрес, воркер его забирает, а ответ потом
// видно в готовом креативе.
//
// Поэтому ссылки принимаются только с наших же хостов: Supabase Storage этого
// проекта, клиентский проект Контент-завода и Cloudinary, куда складывает
// картинки генерация. Расширяется через CONTENT_FACTORY_MEDIA_HOSTS.
//
// Чистые функции — покрыты src/test/mediaHosts.test.ts.

import { isPrivateHostname } from "./safeUrl.ts";

/** Хосты, с которых разрешено брать креативы, по умолчанию. */
export const DEFAULT_MEDIA_HOSTS = [
  ".supabase.co",
  ".supabase.in",
  "res.cloudinary.com",
];

/**
 * Список разрешённых хостов: дефолтные плюс заданные в CONTENT_FACTORY_MEDIA_HOSTS
 * (через запятую). Запись, начинающаяся с точки, означает домен и поддомены.
 */
export function allowedMediaHosts(extraRaw?: string | null): string[] {
  const extra = (extraRaw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_MEDIA_HOSTS, ...extra];
}

function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((entry) =>
    entry.startsWith(".") ? h.endsWith(entry) || h === entry.slice(1) : h === entry
  );
}

/**
 * Годится ли ссылка на креатив для серверной загрузки.
 * Только https и только разрешённый хост — ни схема file:, ни внутренний
 * адрес, ни чужой домен сюда не проходят.
 */
export function isAllowedMediaUrl(raw: string, allowed: string[]): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (isPrivateHostname(url.hostname)) return false;
  return hostAllowed(url.hostname, allowed);
}

/** Разделяет ссылки на принятые и отклонённые — отклонённые показываем человеку. */
export function partitionMediaUrls(
  urls: string[],
  allowed: string[],
): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const url of urls) {
    (isAllowedMediaUrl(url, allowed) ? accepted : rejected).push(url);
  }
  return { accepted, rejected };
}
