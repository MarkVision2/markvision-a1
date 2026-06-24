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

/**
 * Ключ дня по ЛОКАЛЬНОМУ времени — согласован с фильтром периода ниже
 * (он тоже в локальном времени) и с `ymd()` в metricsSourceOfTruth.
 * Раньше ключ брался как `ref.slice(0, 10)` — это UTC-дата из ISO-строки.
 * Для часовых поясов восточнее UTC (Asia/Almaty, UTC+5) лид, оплаченный
 * ночью по локали (например 02:00 = предыдущий день по UTC), попадал в
 * фильтр периода (локаль), но ключевался прошлой датой (UTC) → `.get(iso)`
 * в источнике правды его не находил и выручка «терялась». Теперь и фильтр,
 * и ключ — в одном (локальном) времени.
 */
function dayKeyLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
        const key = dayKeyLocal(ref);
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
        const key = dayKeyLocal(ref);
        const cur = m.get(key) ?? empty();
        cur.sales += 1;
        cur.salesRevenue += l.amount || 0;
        m.set(key, cur);
      }
    }
  }
  return m;
}
