/**
 * CRM-срез по дням для таблицы кабинета в Ads (новая launch-логика).
 *
 * - Лиды CRM — по created_at (заявка попала в CRM)
 * - Диагностика — stage_changed → диагностический этап / визит / консультация
 * - Продажи и сумма — по paid_at из CRM
 * - CPL CRM = spend / crmLeads (считается в UI)
 *
 * Атрибуция на кабинет:
 * 1) leads.cabinet_id === cabinetId
 * 2) иначе — Meta-трафик без cabinet_id (utm.source=meta / n8n), если кабинет
 *    единственный Meta у проекта (soleMetaCabinet=true)
 */
import type { LeadLite } from "@/hooks/useLeadsLite";
import type { StageChangeEvent } from "@/hooks/useStageChangeEvents";
import { ymdAlmatyFromIso } from "@/lib/metaSync";
import { stageRoleOf } from "@/lib/stageRoles";

export interface AdsCabinetCrmDay {
  crmLeads: number;
  diagnostics: number;
  sales: number;
  salesRevenue: number;
}

export function isDiagnosticStageEvent(ev: Pick<StageChangeEvent, "toStageKey" | "toStageRole" | "isDiagnostic">): boolean {
  if (ev.isDiagnostic) return true;
  const role = ev.toStageRole ?? stageRoleOf({ id: ev.toStageKey });
  if (role === "attended" || role === "call_scheduled" || role === "call_done") return true;
  const key = ev.toStageKey.toLowerCase();
  return /diagnostic|диагност|визит|visit|consult|консульт|разбор|scheduled/.test(key);
}

export function isGroupJoinStageKey(toStageKey: string): boolean {
  return stageRoleOf({ id: toStageKey }) === "joined_group";
}

const META_UTM = new Set(["meta", "facebook", "instagram", "fb", "ig", "an"]);

/** Лид похож на Meta-трафик, но cabinet_id ещё не проставлен. */
export function isUnattributedMetaLead(
  lead: Pick<LeadLite, "cabinetId" | "source" | "utm" | "metaAdId">,
): boolean {
  if (lead.cabinetId) return false;
  const src = (lead.source ?? "").trim().toLowerCase();
  if (src.startsWith("broadcast")) return false;
  if (META_UTM.has(src)) return true;
  const utmSrc = String((lead.utm as { source?: string | null } | null)?.source ?? "")
    .trim()
    .toLowerCase();
  if (META_UTM.has(utmSrc)) return true;
  if (src === "zapoinovai" && META_UTM.has(utmSrc)) return true;
  return false;
}

export function leadMatchesCabinet(
  lead: Pick<LeadLite, "cabinetId" | "source" | "utm" | "metaAdId">,
  cabinetId: string,
  opts?: { soleMetaCabinet?: boolean },
): boolean {
  if (lead.cabinetId === cabinetId) return true;
  if (opts?.soleMetaCabinet && isUnattributedMetaLead(lead)) return true;
  return false;
}

export function buildAdsCabinetCrmDaily(
  leads: LeadLite[],
  stageEvents: StageChangeEvent[],
  cabinetId: string,
  sinceYmd: string,
  untilYmd: string,
  opts?: { soleMetaCabinet?: boolean },
): Map<string, AdsCabinetCrmDay> {
  const m = new Map<string, AdsCabinetCrmDay>();
  const get = (ymd: string): AdsCabinetCrmDay => {
    const cur = m.get(ymd) ?? { crmLeads: 0, diagnostics: 0, sales: 0, salesRevenue: 0 };
    m.set(ymd, cur);
    return cur;
  };
  const inRange = (ymd: string) => ymd >= sinceYmd && ymd <= untilYmd;
  const sole = !!opts?.soleMetaCabinet;

  const matchedLeadIds = new Set<string>();
  for (const lead of leads) {
    if (!leadMatchesCabinet(lead, cabinetId, { soleMetaCabinet: sole })) continue;
    matchedLeadIds.add(lead.id);
    const ymd = ymdAlmatyFromIso(lead.createdAt);
    if (!ymd || !inRange(ymd)) continue;
    get(ymd).crmLeads += 1;

    if (lead.paid) {
      const paidYmd = ymdAlmatyFromIso(lead.paidAt || lead.lastActivityAt);
      if (paidYmd && inRange(paidYmd)) {
        const day = get(paidYmd);
        day.sales += 1;
        day.salesRevenue += Math.max(0, Number(lead.amount) || 0);
      }
    }
  }

  // Unique lead per day — повторный переход в диагностический этап не двоит день.
  const diagnosticDay = new Set<string>();
  for (const ev of stageEvents) {
    const cabOk =
      ev.cabinetId === cabinetId ||
      (sole && !ev.cabinetId && matchedLeadIds.has(ev.leadId));
    if (!cabOk) continue;
    if (!isDiagnosticStageEvent(ev)) continue;
    const ymd = ymdAlmatyFromIso(ev.at);
    if (!ymd || !inRange(ymd)) continue;
    const key = `${ymd}:${ev.leadId}`;
    if (diagnosticDay.has(key)) continue;
    diagnosticDay.add(key);
    get(ymd).diagnostics += 1;
  }

  return m;
}

export function sumAdsCabinetCrmDaily(byDay: Map<string, AdsCabinetCrmDay>): AdsCabinetCrmDay {
  let crmLeads = 0;
  let diagnostics = 0;
  let sales = 0;
  let salesRevenue = 0;
  for (const d of byDay.values()) {
    crmLeads += d.crmLeads;
    diagnostics += d.diagnostics;
    sales += d.sales;
    salesRevenue += d.salesRevenue;
  }
  return { crmLeads, diagnostics, sales, salesRevenue };
}
