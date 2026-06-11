import type { LeadLite } from "@/hooks/useLeadsLite";
import type { ReportPeriodRange } from "@/lib/crmDailyMetrics";
import { isLeadConductedVisit, isLeadPaid } from "@/lib/leadStageFlags";

/** Лид квалифицирован, когда скоринг Green API бота >= порога (0-100). */
export const QUAL_SCORE_MIN = 50;

export interface RnpDailyMetrics {
  /** Лидов получено в CRM (created_at). */
  crmReceived: number;
  /** Квал. лиды — скоринг Green API бота >= QUAL_SCORE_MIN. */
  qualified: number;
  /** Запланировано визитов на этот день (next_visit_at). */
  plannedVisits: number;
  /** Проведено визитов / диагностик (факт, не запись). */
  conductedVisits: number;
  /** Оплачено диагностик (шт, diagnostic_amount > 0). */
  diagnosticsPaid: number;
  /** Сумма оплат диагностик ₸. */
  diagnosticRevenuePaid: number;
  /** Наличные за день ₸ (payment_method = cash). */
  cashRevenue: number;
}

function ymdAlmatyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function eventYmd(l: LeadLite): string {
  const ref = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
  return ymdAlmatyFromIso(ref);
}

function inMonthRange(ymd: string, range: ReportPeriodRange): boolean {
  const from = `${range.from.getFullYear()}-${String(range.from.getMonth() + 1).padStart(2, "0")}-${String(range.from.getDate()).padStart(2, "0")}`;
  const to = `${range.to.getFullYear()}-${String(range.to.getMonth() + 1).padStart(2, "0")}-${String(range.to.getDate()).padStart(2, "0")}`;
  return ymd >= from && ymd <= to;
}

/** РНП-метрики по дням для «Таблицы показателей». */
export function metricsRnpDaily(
  leads: LeadLite[],
  range: ReportPeriodRange,
  cabinetSelector: "all" | string,
): Map<string, RnpDailyMetrics> {
  const matchCabinet = (l: LeadLite) =>
    cabinetSelector === "all" || l.cabinetId === cabinetSelector;

  const empty = (): RnpDailyMetrics => ({
    crmReceived: 0,
    qualified: 0,
    plannedVisits: 0,
    conductedVisits: 0,
    diagnosticsPaid: 0,
    diagnosticRevenuePaid: 0,
    cashRevenue: 0,
  });

  const m = new Map<string, RnpDailyMetrics>();

  for (const l of leads) {
    if (!matchCabinet(l)) continue;

    const createdYmd = ymdAlmatyFromIso(l.createdAt);
    if (createdYmd && inMonthRange(createdYmd, range)) {
      const cur = m.get(createdYmd) ?? empty();
      cur.crmReceived += 1;
      if ((l.aiScore ?? 0) >= QUAL_SCORE_MIN) cur.qualified += 1;
      m.set(createdYmd, cur);
    }

    if (l.nextVisitAt) {
      const planYmd = ymdAlmatyFromIso(l.nextVisitAt);
      if (planYmd && inMonthRange(planYmd, range)) {
        const cur = m.get(planYmd) ?? empty();
        cur.plannedVisits += 1;
        m.set(planYmd, cur);
      }
    }

    if (isLeadConductedVisit(l)) {
      const ymd = eventYmd(l);
      if (ymd && inMonthRange(ymd, range)) {
        const cur = m.get(ymd) ?? empty();
        cur.conductedVisits += 1;
        m.set(ymd, cur);
      }
    }

    if ((l.diagnosticAmount ?? 0) > 0) {
      const ymd = eventYmd(l);
      if (ymd && inMonthRange(ymd, range)) {
        const cur = m.get(ymd) ?? empty();
        cur.diagnosticsPaid += 1;
        cur.diagnosticRevenuePaid += l.diagnosticAmount;
        m.set(ymd, cur);
      }
    }

    if (isLeadPaid(l) && l.paymentMethod === "cash" && (l.amount ?? 0) > 0) {
      const ymd = eventYmd(l);
      if (ymd && inMonthRange(ymd, range)) {
        const cur = m.get(ymd) ?? empty();
        cur.cashRevenue += l.amount;
        m.set(ymd, cur);
      }
    }
  }

  return m;
}
