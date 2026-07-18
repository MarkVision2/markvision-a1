export const CODEWORD_MAX_VARIANTS = 10;

export function normalizeVariantList(items: string[] | null | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((s) => String(s).trim()).filter(Boolean).slice(0, CODEWORD_MAX_VARIANTS);
}

export function clickConversionRate(dms: number, clicks: number): number | null {
  if (dms <= 0) return null;
  return Math.round((clicks / dms) * 1000) / 10;
}

export function formatClickConversion(dms: number, clicks: number): string {
  const rate = clickConversionRate(dms, clicks);
  if (rate == null) return "—";
  return `${rate}%`;
}
