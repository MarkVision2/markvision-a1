import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

export interface CreativesSummary {
  total: number;
  active: number;
  spend: number;
  /** Заявки + сообщения Meta за период. */
  results: number;
  crmRevenue: number;
  crmProfit: number;
  crmSales: number;
  hasCrm: boolean;
  /** Лучший креатив по ROMI CRM среди тех, у кого есть расход и выручка. */
  best: MetaCreativeRow | null;
}

export function buildCreativesSummary(rows: MetaCreativeRow[]): CreativesSummary {
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const crmRevenue = rows.reduce((sum, row) => sum + row.crmRevenue, 0);
  const candidates = rows.filter((row) => row.crmRevenue > 0 && row.spend > 0);
  const best = candidates.length > 0
    ? candidates.reduce((acc, row) => (row.crmRomi > acc.crmRomi ? row : acc))
    : null;

  return {
    total: rows.length,
    active: rows.filter((row) => (row.effectiveStatus ?? "").toUpperCase() === "ACTIVE").length,
    spend,
    results: rows.reduce((sum, row) => sum + row.leads + row.messages, 0),
    crmRevenue,
    crmProfit: crmRevenue - spend,
    crmSales: rows.reduce((sum, row) => sum + row.crmSales, 0),
    hasCrm: crmRevenue > 0,
    best,
  };
}
