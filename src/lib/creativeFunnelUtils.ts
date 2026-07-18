import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import type { LeadLite } from "@/hooks/useLeadsLite";
import {
  aggregateProjectCrmTotals,
  type LeadForCreativeCrm,
  type ProjectCrmTotals,
} from "@/lib/creativeCrmMetrics";
import type { ReportPeriodRange } from "@/hooks/useReportData";

/** Лиды Meta: для WA-кампаний важнее messages, чем leads. */
export function metaLeadCount(row: Pick<MetaCreativeRow, "leads" | "messages">): number {
  return Math.max(row.leads ?? 0, row.messages ?? 0);
}

export function creativeDedupKey(row: MetaCreativeRow): string {
  return (
    row.videoId
    || row.videoUrl
    || row.imageUrl
    || row.thumbnailUrl
    || row.posterUrl
    || `name:${row.creativeType}:${row.name}`
  );
}

function recalcDerived(row: MetaCreativeRow): MetaCreativeRow {
  const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
  const cpl = row.leads > 0 ? row.spend / row.leads : 0;
  const cpc = row.clicks > 0 ? row.spend / row.clicks : 0;
  const cpm = row.impressions > 0 ? (row.spend / row.impressions) * 1000 : 0;
  const romi = row.spend > 0 ? ((row.revenue - row.spend) / row.spend) * 100 : 0;
  const crmCpl = row.crmLeads > 0 ? row.spend / row.crmLeads : 0;
  const crmCps = row.crmSales > 0 ? row.spend / row.crmSales : 0;
  const crmAvgCheck = row.crmSales > 0 ? row.crmRevenue / row.crmSales : 0;
  const crmRomi = row.spend > 0 ? ((row.crmRevenue - row.spend) / row.spend) * 100 : 0;
  const crmProfit = row.crmRevenue - row.spend;
  return { ...row, ctr, cpl, cpc, cpm, romi, crmCpl, crmCps, crmAvgCheck, crmRomi, crmProfit };
}

/** Объединяет дубли креативов (одно медиа в разных кампаниях) и суммирует метрики. */
export function dedupMetaCreatives(rows: MetaCreativeRow[]): MetaCreativeRow[] {
  const groups = new Map<string, MetaCreativeRow>();
  for (const row of rows) {
    const key = creativeDedupKey(row);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...row, mergedAdIds: [row.adId] });
      continue;
    }
    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.leads += row.leads;
    existing.messages += row.messages;
    existing.purchases += row.purchases;
    existing.revenue += row.revenue;
    existing.crmLeads += row.crmLeads;
    existing.crmQualified += row.crmQualified;
    existing.crmSales += row.crmSales;
    existing.crmDiagnostics += row.crmDiagnostics;
    existing.crmRevenue += row.crmRevenue;
    existing.mergedAdIds = Array.from(new Set([...(existing.mergedAdIds ?? [existing.adId]), row.adId]));
    if (row.effectiveStatus === "ACTIVE") existing.effectiveStatus = "ACTIVE";
  }
  return Array.from(groups.values()).map(recalcDerived);
}

export function buildAdToCabinetMap(rows: MetaCreativeRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.adId && row.cabinetId) map.set(row.adId, row.cabinetId);
  }
  return map;
}

export function leadMatchesCabinet(
  lead: Pick<LeadLite, "cabinetId" | "metaAdId">,
  cabinetId: string | "all",
  adToCabinet: Map<string, string>,
): boolean {
  if (cabinetId === "all") return true;
  if (lead.cabinetId === cabinetId) return true;
  const adCab = lead.metaAdId?.trim() ? adToCabinet.get(lead.metaAdId.trim()) : undefined;
  return adCab === cabinetId;
}

export function filterRowsByCabinet(rows: MetaCreativeRow[], cabinetId: string | "all"): MetaCreativeRow[] {
  if (cabinetId === "all") return rows;
  return rows.filter((r) => r.cabinetId === cabinetId);
}

export function projectLeadsForScope(
  leads: LeadLite[],
  projectId: string | null | undefined,
  cabinetId: string | "all",
  adToCabinet: Map<string, string>,
): LeadForCreativeCrm[] {
  return leads
    .filter((l) => {
      if (projectId && l.projectId != null && l.projectId !== projectId) return false;
      return leadMatchesCabinet(l, cabinetId, adToCabinet);
    })
    .map((l) => ({
      metaAdId: l.metaAdId,
      createdAt: l.createdAt,
      paidAt: l.paidAt,
      lastActivityAt: l.lastActivityAt,
      stageKey: l.stageKey,
      amount: l.amount,
      diagnosticAmount: l.diagnosticAmount,
      paid: l.paid,
    }));
}

export function computeProjectCrmTotals(
  leads: LeadLite[],
  range: ReportPeriodRange,
  projectId: string | null | undefined,
  cabinetId: string | "all",
  adToCabinet: Map<string, string>,
): ProjectCrmTotals {
  return aggregateProjectCrmTotals(projectLeadsForScope(leads, projectId, cabinetId, adToCabinet), range);
}

export interface CreativeTableTotals {
  spend: number;
  metaLeads: number;
  crmLeads: number;
  crmQualified: number;
  crmDiagnostics: number;
  crmSales: number;
  crmRevenue: number;
}

export function sumCreativeTableTotals(rows: MetaCreativeRow[]): CreativeTableTotals {
  return rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      metaLeads: acc.metaLeads + metaLeadCount(r),
      crmLeads: acc.crmLeads + r.crmLeads,
      crmQualified: acc.crmQualified + r.crmQualified,
      crmDiagnostics: acc.crmDiagnostics + r.crmDiagnostics,
      crmSales: acc.crmSales + r.crmSales,
      crmRevenue: acc.crmRevenue + r.crmRevenue,
    }),
    {
      spend: 0,
      metaLeads: 0,
      crmLeads: 0,
      crmQualified: 0,
      crmDiagnostics: 0,
      crmSales: 0,
      crmRevenue: 0,
    },
  );
}

export type CreativeDecisionKey =
  | "scale"
  | "unprofitable"
  | "funnel_leak"
  | "attribution_gap"
  | "no_results"
  | "learning";

export interface CreativeDecision {
  key: CreativeDecisionKey;
  label: string;
  action: string;
  tone: "success" | "danger" | "warning" | "info" | "muted";
}

/**
 * Диагноз опирается только на факты выбранного периода. Не называем это
 * «выгоранием»: без частоты и сравнения с предыдущим окном такой вывод неверен.
 */
export function classifyCreativeDecision(row: MetaCreativeRow): CreativeDecision {
  const metaLeads = metaLeadCount(row);
  const hasPositiveProfit = row.spend > 0 && row.crmRevenue > row.spend && row.crmSales > 0;

  if (hasPositiveProfit) {
    return {
      key: "scale",
      label: "Победитель",
      action: "Проверить масштабирование",
      tone: "success",
    };
  }
  if (row.crmSales > 0 && row.spend > 0 && row.crmRevenue <= row.spend) {
    return {
      key: "unprofitable",
      label: "Не окупается",
      action: "Снизить стоимость продажи",
      tone: "danger",
    };
  }
  if (row.crmLeads > 0 && row.crmSales === 0) {
    return {
      key: "funnel_leak",
      label: "Потеря после лида",
      action: "Проверить обработку в CRM",
      tone: "warning",
    };
  }
  if (metaLeads > 0 && row.crmLeads === 0) {
    return {
      key: "attribution_gap",
      label: "Нет связи с CRM",
      action: "Проверить ad.id и UTM",
      tone: "info",
    };
  }
  if (row.spend > 0 && metaLeads === 0 && row.crmLeads === 0) {
    return {
      key: "no_results",
      label: "Расход без лидов",
      action: "Проверить или заменить",
      tone: "danger",
    };
  }
  return {
    key: "learning",
    label: "Мало данных",
    action: row.spend > 0 ? "Наблюдать" : "Нет доставки за период",
    tone: "muted",
  };
}

export interface CreativeDecisionSummary {
  spend: number;
  revenue: number;
  profit: number;
  sales: number;
  winners: number;
  riskSpend: number;
  attributedCrmLeads: number;
  unattributedCrmLeads: number;
  attributionCoverage: number;
  bestCreative: MetaCreativeRow | null;
}

export function buildCreativeDecisionSummary(
  rows: MetaCreativeRow[],
  totalProjectCrmLeads: number,
): CreativeDecisionSummary {
  const totals = sumCreativeTableTotals(rows);
  const decisions = rows.map((row) => ({ row, decision: classifyCreativeDecision(row) }));
  const riskKeys = new Set<CreativeDecisionKey>([
    "unprofitable",
    "funnel_leak",
    "attribution_gap",
    "no_results",
  ]);
  const winners = decisions.filter(({ decision }) => decision.key === "scale");
  const bestCreative = winners
    .map(({ row }) => row)
    .sort((a, b) => b.crmProfit - a.crmProfit || b.crmRevenue - a.crmRevenue)[0] ?? null;
  const unattributedCrmLeads = Math.max(0, totalProjectCrmLeads - totals.crmLeads);

  return {
    spend: totals.spend,
    revenue: totals.crmRevenue,
    profit: totals.crmRevenue - totals.spend,
    sales: totals.crmSales,
    winners: winners.length,
    riskSpend: decisions.reduce(
      (sum, { row, decision }) => sum + (riskKeys.has(decision.key) ? row.spend : 0),
      0,
    ),
    attributedCrmLeads: totals.crmLeads,
    unattributedCrmLeads,
    attributionCoverage: totalProjectCrmLeads > 0
      ? Math.min(100, (totals.crmLeads / totalProjectCrmLeads) * 100)
      : 0,
    bestCreative,
  };
}

export type CreativeSortKey =
  | "crmRevenue"
  | "crmRomi"
  | "crmSales"
  | "crmLeads"
  | "leads"
  | "spend"
  | "ctr"
  | "cpl"
  | "name";
export type CreativeSortDir = "asc" | "desc";

export function sortCreativeRows(
  rows: MetaCreativeRow[],
  sortKey: CreativeSortKey,
  sortDir: CreativeSortDir,
): MetaCreativeRow[] {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name, "ru") * direction;

    const value = (row: MetaCreativeRow) => {
      if (sortKey === "leads") return metaLeadCount(row);
      if (sortKey === "cpl") return row.crmCpl;
      return Number(row[sortKey]) || 0;
    };
    const av = value(a);
    const bv = value(b);
    // Нулевой CPL означает отсутствие результата, а не лучший CPL.
    if (sortKey === "cpl") {
      if (av === 0 && bv !== 0) return 1;
      if (bv === 0 && av !== 0) return -1;
    }
    return (av - bv) * direction;
  });
}
