import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

export type CreativeSortKey =
  | "crmRevenue"
  | "crmLeads"
  | "crmRomi"
  | "spend"
  | "ctr"
  | "cpl"
  | "leads"
  | "romi";

/** Значение для первичной сортировки. Для crmLeads — только CRM, без подмены Meta. */
export function creativeSortValue(r: MetaCreativeRow, key: CreativeSortKey): number {
  if (key === "cpl") return r.cpl > 0 ? -r.cpl : Number.NEGATIVE_INFINITY;
  if (key === "crmLeads") return r.crmLeads ?? 0;
  return (r as unknown as Record<string, number>)[key] ?? 0;
}

/**
 * Сравнение креативов для топа.
 * crmLeads: сначала CRM-лиды, при равенстве — Meta leads, затем расход.
 * (Раньше Meta leads подставлялись в primary → креатив с 0 CRM и 8 Meta
 * обгонял креатив с 3 CRM.)
 */
export function compareCreatives(
  a: MetaCreativeRow,
  b: MetaCreativeRow,
  key: CreativeSortKey,
): number {
  const primary = creativeSortValue(b, key) - creativeSortValue(a, key);
  if (primary !== 0) return primary;
  if (key === "crmLeads" || key === "leads") {
    const metaDelta = b.leads - a.leads;
    if (metaDelta !== 0) return metaDelta;
    return b.spend - a.spend;
  }
  const crmDelta = (b.crmSales ?? 0) - (a.crmSales ?? 0);
  if (crmDelta !== 0) return crmDelta;
  return b.spend - a.spend;
}
