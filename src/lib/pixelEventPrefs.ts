/** Скрытые события пикселя в мастере кампании (localStorage, per pixel id). */

const KEY_PREFIX = "mv:ads:hidden-pixel-events:";

export function readHiddenPixelEvents(pixelId: string): string[] {
  if (!pixelId) return [];
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${pixelId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeHiddenPixelEvents(pixelId: string, hidden: string[]) {
  if (!pixelId) return;
  try {
    localStorage.setItem(`${KEY_PREFIX}${pixelId}`, JSON.stringify(hidden));
  } catch {
    /* quota */
  }
}

/** Скрыть всё, кроме перечисленных имён (например только Lead). */
export function hideAllExcept(pixelId: string, allEventNames: string[], keep: string[]) {
  const keepSet = new Set(keep.map((n) => n.toLowerCase()));
  const hidden = allEventNames.filter((n) => !keepSet.has(n.toLowerCase()));
  writeHiddenPixelEvents(pixelId, hidden);
  return hidden;
}
