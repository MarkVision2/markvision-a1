const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function sanitizeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed, "http://_relative_/");
    if (!SAFE_PROTOCOLS.has(url.protocol)) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}
