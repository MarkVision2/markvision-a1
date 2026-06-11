import type { LeadLite } from "@/hooks/useLeadsLite";
import type { StageChangeEvent } from "@/hooks/useStageChangeEvents";
import type { ReportPeriodRange } from "@/lib/crmDailyMetrics";
import { ymdLocal } from "@/lib/metricsPeriod";

const SCHEDULED_KEYS = new Set([
  "scheduled", "scheduled_diag", "записан", "запись",
]);

const CONDUCTED_KEYS = new Set([
  "visit", "diagnosed", "diagnostic", "визит", "диагностика", "арегистрация",
]);

export interface RnpDailyMetrics {
  crmReceived: number;
  scheduled: number;
  conducted: number;
  diagnosticsPaid: number;
  diagnosticRevenuePaid: number;
  sales: number;
  salesRevenue: number;
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

function inDateRange(ymd: string, range: ReportPeriodRange): boolean {
  const from = ymdLocal(range.from);
  const to = ymdLocal(range.to);
  return ymd >= from && ymd <= to;
}

/** РНП-метрики по дням для «Таблицы показателей» (Фаза 1). */
export function metricsRnpDaily(
  leads: LeadLite[],
  stageEvents: StageChangeEvent[],
  range: ReportPeriodRange,
  cabinetSelector: "all" | string,
): Map<string, RnpDailyMetrics> {
  const matchCabinet = (cabinetId: string | null) =>
    cabinetSelector === "all" || cabinetId === cabinetSelector;

  const empty = (): RnpDailyMetrics => ({
    crmReceived: 0,
    scheduled: 0,
    conducted: 0,
    diagnosticsPaid: 0,
    diagnosticRevenuePaid: 0,
    sales: 0,
    salesRevenue: 0,
    cashRevenue: 0,
  });

  const m = new Map<string, RnpDailyMetrics>();

  for (const l of leads) {
    if (!matchCabinet(l.cabinetId)) continue;

    const createdYmd = ymdAlmatyFromIso(l.createdAt);
    if (createdYmd && inDateRange(createdYmd, range)) {
      const cur = m.get(createdYmd) ?? empty();
      cur.crmReceived += 1;
      m.set(createdYmd, cur);
    }

    if (l.paidAt && (l.diagnosticAmount ?? 0) > 0) {
      const ymd = ymdAlmatyFromIso(l.paidAt);
      if (ymd && inDateRange(ymd, range)) {
        const cur = m.get(ymd) ?? empty();
        cur.diagnosticsPaid += 1;
        cur.diagnosticRevenuePaid += l.diagnosticAmount;
        m.set(ymd, cur);
      }
    }

    if (l.paid === true && l.paidAt) {
      const ymd = ymdAlmatyFromIso(l.paidAt);
      if (ymd && inDateRange(ymd, range)) {
        const cur = m.get(ymd) ?? empty();
        cur.sales += 1;
        cur.salesRevenue += l.amount ?? 0;
        if (l.paymentMethod === "cash" && (l.amount ?? 0) > 0) {
          cur.cashRevenue += l.amount;
        }
        m.set(ymd, cur);
      }
    }
  }

  for (const ev of stageEvents) {
    if (!matchCabinet(ev.cabinetId)) continue;
    if (!ev.isDiagnostic) continue;
    const ymd = ymdAlmatyFromIso(ev.at);
    if (!ymd || !inDateRange(ymd, range)) continue;
    const key = ev.toStageKey.toLowerCase();
    const cur = m.get(ymd) ?? empty();
    if (SCHEDULED_KEYS.has(key)) cur.scheduled += 1;
    else if (CONDUCTED_KEYS.has(key)) cur.conducted += 1;
    else continue;
    m.set(ymd, cur);
  }

  return m;
}

export function sumRnpDaily(map: Map<string, RnpDailyMetrics>): RnpDailyMetrics {
  const total = emptyTotals();
  for (const v of map.values()) {
    total.crmReceived += v.crmReceived;
    total.scheduled += v.scheduled;
    total.conducted += v.conducted;
    total.diagnosticsPaid += v.diagnosticsPaid;
    total.diagnosticRevenuePaid += v.diagnosticRevenuePaid;
    total.sales += v.sales;
    total.salesRevenue += v.salesRevenue;
    total.cashRevenue += v.cashRevenue;
  }
  return total;
}

function emptyTotals(): RnpDailyMetrics {
  return {
    crmReceived: 0,
    scheduled: 0,
    conducted: 0,
    diagnosticsPaid: 0,
    diagnosticRevenuePaid: 0,
    sales: 0,
    salesRevenue: 0,
    cashRevenue: 0,
  };
}
