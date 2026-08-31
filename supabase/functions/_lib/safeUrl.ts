// Проверка URL перед серверным запросом.
//
// Edge-функции ходят по ссылкам, которые пришли от пользователя: референсные
// фото и страница товара в Контент-заводе, креативы в запуске рекламы. Без
// проверки это SSRF — внутренний адрес был бы запрошен из нашей сети, а ответ
// вернулся бы пользователю (в тексте промпта или в готовой картинке).
//
// Чистые функции — покрыты src/test/safeUrl.test.ts.

/**
 * Приватные, служебные и локальные имена. Литеральные адреса запрещаем
 * целиком: у настоящего сайта или CDN всегда есть доменное имя, а IP в ссылке —
 * почти всегда попытка достучаться до внутренней сети.
 */
export function isPrivateHostname(host: string): boolean {
  const h = (host ?? "").toLowerCase().trim();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".home.arpa")) return true;
  // IPv6 в URL приходит в квадратных скобках.
  if (h.startsWith("[")) return true;
  // Любой IPv4-литерал.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // Числовые и шестнадцатеричные формы записи адреса (0x7f000001, 2130706433).
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true;
  return false;
}

/** Ссылка, по которой серверу можно ходить: http(s) и не внутренний адрес. */
export function isPublicHttpUrl(raw: string): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !isPrivateHostname(url.hostname);
}

/**
 * Запрос к внешней странице с ручным разбором редиректов.
 *
 * fetch по умолчанию идёт по редиректам сам, и внешний сайт мог бы увести нас
 * на внутренний адрес уже после проверки. Поэтому переходы разбираем вручную
 * и проверяем каждый следующий адрес.
 */
export async function fetchPublicUrl(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 3,
): Promise<Response | null> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isPublicHttpUrl(current)) return null;
    let res: Response;
    try {
      res = await fetch(current, { ...init, redirect: "manual" });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      // Относительный редирект разрешаем относительно текущего адреса.
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    return res;
  }
  return null;
}
