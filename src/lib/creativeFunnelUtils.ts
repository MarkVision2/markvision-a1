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
