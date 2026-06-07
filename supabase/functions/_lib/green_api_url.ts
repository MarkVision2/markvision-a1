// Allowlist Green API base URLs to prevent SSRF via user-supplied api_url.

export const DEFAULT_GREEN_API_BASE_URL = "https://api.green-api.com";

const ALLOWED_EXACT_HOSTS = new Set([
  "api.green-api.com",
  "api.greenapi.com",
]);

/** Regional/media hosts, e.g. 7105.api.greenapi.com */
const ALLOWED_HOST_SUFFIX = ".api.greenapi.com";
const ALLOWED_SUBDOMAIN_PATTERN = /^[a-z0-9-]+\.api\.greenapi\.com$/i;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isPrivateOrMetadataHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h === "169.254.169.254") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (h.includes(":")) return true; // IPv6 literal
  return false;
}

export function isAllowedGreenApiHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim();
  if (!h || isPrivateOrMetadataHost(h)) return false;
  if (ALLOWED_EXACT_HOSTS.has(h)) return true;
  if (h.endsWith(ALLOWED_HOST_SUFFIX) && ALLOWED_SUBDOMAIN_PATTERN.test(h)) {
    return true;
  }
  return false;
}

/** Returns normalized origin (no trailing slash). Empty input → default Green API URL. */
export function validateGreenApiBaseUrl(raw: string | null | undefined): string {
  if (!raw?.trim()) return DEFAULT_GREEN_API_BASE_URL;

  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Invalid apiUrl");
  }

  if (u.protocol !== "https:") throw new Error("apiUrl must use https");
  if (u.username || u.password) throw new Error("apiUrl must not contain credentials");
  if (u.pathname !== "/" && u.pathname !== "") {
    throw new Error("apiUrl must not include a path");
  }
  if (u.search || u.hash) throw new Error("apiUrl must not include query or hash");

  const host = u.hostname.toLowerCase();
  if (!isAllowedGreenApiHost(host)) {
    throw new Error("apiUrl host not allowed");
  }

  return u.origin.replace(/\/+$/, "");
}
