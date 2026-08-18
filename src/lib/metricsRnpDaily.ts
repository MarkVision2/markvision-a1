import type { LeadLite } from "@/hooks/useLeadsLite";
import type { StageChangeEvent } from "@/hooks/useStageChangeEvents";
import type { ReportPeriodRange } from "@/lib/crmDailyMetrics";
import { isGroupJoinStageKey } from "@/lib/adsCabinetCrmDaily";
import { ymdAlmatyFromIso } from "@/lib/metaSync";
import { isLeadConductedVisit, isLeadPaid } from "@/lib/leadStageFlags";
import { stageRoleOf, type StageRole } from "@/lib/stageRoles";

export const QUAL_SCORE_MIN = 50;

export interface RnpDailyMetrics {
  crmReceived: number;
  qualified: number;
  /** Вступления в группу (stage → joined_group). */
  joins: number;
  plannedVisits: number;
  conductedVisits: number;
  /** Записано (stage_changed → scheduled). */
  scheduled: number;
  /** Проведено (stage_changed → visit / conducted). */
  conducted: number;
  diagnosticsPaid: number;
  diagnosticRevenuePaid: number;
  sales: number;
  salesRevenue: number;
  cashRevenue: number;
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

function empty(): RnpDailyMetrics {
  return {
    crmReceived: 0,
    qualified: 0,
    joins: 0,
    plannedVisits: 0,
    conductedVisits: 0,
    scheduled: 0,
    conducted: 0,
    diagnosticsPaid: 0,
    diagnosticRevenuePaid: 0,
    sales: 0,
    salesRevenue: 0,
    cashRevenue: 0,
  };
}

/** РНП-метрики по дням. stageEvents — вступления / scheduled / conducted. */
export function metricsRnpDaily(
  leads: LeadLite[],
  stageEvents: StageChangeEvent[],
  range: ReportPeriodRange,
  cabinetSelector: "all" | string,
): Map<string, RnpDailyMetrics> {
  const matchCabinet = (cabinetId: string | null | undefined) =>
    cabinetSelector === "all" || cabinetId === cabinetSelector;

  const m = new Map<string, RnpDailyMetrics>();
  const get = (ymd: string): RnpDailyMetrics => {
    const cur = m.get(ymd) ?? empty();
    m.set(ymd, cur);
    return cur;
  };

  for (const l of leads) {
    if (!matchCabinet(l.cabinetId)) continue;

    const createdYmd = ymdAlmatyFromIso(l.createdAt);
    if (createdYmd && inMonthRange(createdYmd, range)) {
      const cur = get(createdYmd);
      cur.crmReceived += 1;
      if ((l.aiScore ?? 0) >= QUAL_SCORE_MIN) cur.qualified += 1;
    }

    if (l.nextVisitAt) {
      const planYmd = ymdAlmatyFromIso(l.nextVisitAt);
      if (planYmd && inMonthRange(planYmd, range)) {
        get(planYmd).plannedVisits += 1;
      }
    }

    if (isLeadConductedVisit(l)) {
      const ymd = eventYmd(l);
      if (ymd && inMonthRange(ymd, range)) {
        get(ymd).conductedVisits += 1;
      }
    }

    if ((l.diagnosticAmount ?? 0) > 0 && l.paidAt) {
      const ymd = ymdAlmatyFromIso(l.paidAt);
      if (ymd && inMonthRange(ymd, range)) {
        const cur = get(ymd);
        cur.diagnosticsPaid += 1;
        cur.diagnosticRevenuePaid += l.diagnosticAmount ?? 0;
      }
    }

    if (isLeadPaid(l) && (l.amount ?? 0) > 0 && l.paidAt) {
      const ymd = ymdAlmatyFromIso(l.paidAt);
      if (ymd && inMonthRange(ymd, range)) {
        const cur = get(ymd);
        cur.sales += 1;
        cur.salesRevenue += l.amount ?? 0;
        if (l.paymentMethod === "cash") {
          cur.cashRevenue += l.amount ?? 0;
        }
      }
    }
  }

  const joinedDay = new Set<string>();
  for (const ev of stageEvents) {
    if (!matchCabinet(ev.cabinetId)) continue;
    const ymd = ymdAlmatyFromIso(ev.at);
    if (!ymd || !inMonthRange(ymd, range)) continue;

    const role = stageRoleOf({ stageRole: ev.toStageRole as StageRole | null, id: ev.toStageKey });

    if (role === "joined_group" || isGroupJoinStageKey(ev.toStageKey)) {
      const key = `${ymd}:${ev.leadId}`;
      if (!joinedDay.has(key)) {
        joinedDay.add(key);
        get(ymd).joins += 1;
      }
      continue;
    }

    if (!ev.isDiagnostic) continue;
    const cur = get(ymd);
    if (
      role === "call_scheduled" ||
      ev.toStageKey === "scheduled" ||
      ev.toStageKey === "scheduled_diag"
    ) {
      cur.scheduled += 1;
    } else if (
      role === "call_done" ||
      role === "attended" ||
      ev.toStageKey === "visit" ||
      ev.toStageKey === "conducted" ||
      ev.toStageKey === "diagnostic" ||
      ev.toStageKey === "diagnosed"
    ) {
      cur.conducted += 1;
    }
  }

  return m;
}

export function sumRnpDaily(map: Map<string, RnpDailyMetrics>): RnpDailyMetrics {
  const total = empty();
  for (const v of map.values()) {
    total.crmReceived += v.crmReceived;
    total.qualified += v.qualified;
    total.joins += v.joins;
    total.plannedVisits += v.plannedVisits;
    total.conductedVisits += v.conductedVisits;
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
