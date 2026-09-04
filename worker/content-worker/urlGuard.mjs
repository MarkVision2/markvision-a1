/**
 * Защита загрузчика от SSRF — зеркало checkSourceUrl из
 * supabase/functions/_lib/contentPipeline.ts для Node-воркера.
 *
 * Правила: только https, только allowlist доменов (точное совпадение или
 * поддомен), без учётных данных и нестандартных портов, без IP-литералов,
 * private / loopback / link-local / CGNAT хостов. Отдельно — проверка
 * IP-адресов, в которые резолвится хост (isPrivateIp), чтобы DNS не увёл
 * загрузку внутрь сети.
 */

export const DEFAULT_ALLOWED_HOSTS = [
  "files2.heygen.ai",
  "files.heygen.ai",
  "resource2.heygen.ai",
  "resource.heygen.ai",
  "static.heygen.ai",
  "app.heygen.com",
];

export function parseAllowedHosts(raw) {
  const list = String(raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/^\*\./, ""))
    .filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED_HOSTS;
}

function isIpLiteral(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

export function isPrivateHost(hostRaw) {
  const host = String(hostRaw).toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  return isPrivateIp(host);
}

/** IPv4/IPv6-адрес из приватного, loopback, link-local или CGNAT диапазона. */
export function isPrivateIp(ipRaw) {
  const ip = String(ipRaw).toLowerCase();
  if (/^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  if (/^0\./.test(ip)) return true;
  const m172 = /^172\.(\d+)\./.exec(ip);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  if (ip === "::1" || ip === "::") return true;
  if (/^(fc|fd)/.test(ip) || /^fe[89ab]/.test(ip)) return true;
  if (/^::ffff:/.test(ip)) return isPrivateIp(ip.replace(/^::ffff:/, ""));
  return false;
}

/**
 * @returns {{ok:true,url:URL}|{ok:false,reason:string}}
 */
export function checkSourceUrl(raw, allowlist = DEFAULT_ALLOWED_HOSTS) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && url.port !== "443") return { ok: false, reason: "port" };
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) return { ok: false, reason: "ip_literal" };
  if (isPrivateHost(host)) return { ok: false, reason: "private_host" };
  const allowed = allowlist.some((d) => {
    const dom = String(d).toLowerCase().replace(/^\*\./, "");
    return dom === "*" || host === dom || host.endsWith(`.${dom}`);
  });
  if (!allowed) return { ok: false, reason: "not_allowlisted" };
  return { ok: true, url };
}

/** Безопасное имя файла результата: только uuid/буквы/цифры, версия — целое. */
export function outputFileName(contentId, version) {
  const id = String(contentId ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,80}$/.test(id)) return null;
  if (version == null || version === "") return `${id}.mp4`;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1 || v > 9999) return null;
  return `${id}_v${v}.mp4`;
}
