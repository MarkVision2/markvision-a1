import type { LeadLite } from "@/hooks/useLeadsLite";
import { isLeadDiagnosticEvent, isLeadPaid } from "@/lib/leadStageFlags";

export interface ReportPeriodRange {
  from: Date;
  to: Date;
}

export interface CrmDailyMetrics {
  diagnostics: number;
  diagnosticRevenue: number;
  sales: number;
  salesRevenue: number;
}

/** CRM-факты по дням (источник правды для диагностик/продаж в Таблице показателей). */
export function crmDailyMetrics(
  leads: LeadLite[],
  range: ReportPeriodRange,
  cabinetSelector: "all" | string,
): Map<string, CrmDailyMetrics> {
  const fromTs = range.from.getTime();
  const toTs = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1).getTime();
  const matchCabinet = (l: LeadLite) =>
    cabinetSelector === "all" || l.cabinetId === cabinetSelector;
  const empty = (): CrmDailyMetrics => ({
    diagnostics: 0,
    diagnosticRevenue: 0,
    sales: 0,
    salesRevenue: 0,
  });
  const m = new Map<string, CrmDailyMetrics>();

  for (const l of leads) {
    if (!matchCabinet(l)) continue;
    if (isLeadDiagnosticEvent(l)) {
      const ref = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(ref).getTime();
      if (t >= fromTs && t < toTs) {
        const key = ref.slice(0, 10);
        const cur = m.get(key) ?? empty();
        cur.diagnostics += 1;
        cur.diagnosticRevenue += l.diagnosticAmount || 0;
        m.set(key, cur);
      }
    }
    if (isLeadPaid(l)) {
      const ref = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(ref).getTime();
      if (t >= fromTs && t < toTs) {
        const key = ref.slice(0, 10);
        const cur = m.get(key) ?? empty();
        cur.sales += 1;
        cur.salesRevenue += l.amount || 0;
        m.set(key, cur);
      }
    }
  }
  return m;
}
