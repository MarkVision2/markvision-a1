/**
 * CRM-срез по дням для таблицы кабинета в Ads (новая launch-логика).
 *
 * - Лиды CRM — по created_at (заявка попала в CRM)
 * - Вступления — stage_changed → joined_group / warming (факт входа в группу)
 * - CPL CRM = spend / crmLeads (считается в UI)
 */
import type { LeadLite } from "@/hooks/useLeadsLite";
import type { StageChangeEvent } from "@/hooks/useStageChangeEvents";
import { ymdAlmatyFromIso } from "@/lib/metaSync";
import { stageRoleOf } from "@/lib/stageRoles";

export interface AdsCabinetCrmDay {
  crmLeads: number;
  joins: number;
}

export function isGroupJoinStageKey(toStageKey: string): boolean {
  return stageRoleOf({ id: toStageKey }) === "joined_group";
}

export function buildAdsCabinetCrmDaily(
  leads: LeadLite[],
  stageEvents: StageChangeEvent[],
  cabinetId: string,
  sinceYmd: string,
  untilYmd: string,
): Map<string, AdsCabinetCrmDay> {
  const m = new Map<string, AdsCabinetCrmDay>();
  const get = (ymd: string): AdsCabinetCrmDay => {
    const cur = m.get(ymd) ?? { crmLeads: 0, joins: 0 };
    m.set(ymd, cur);
    return cur;
  };
  const inRange = (ymd: string) => ymd >= sinceYmd && ymd <= untilYmd;

  for (const lead of leads) {
    if (lead.cabinetId !== cabinetId) continue;
    const ymd = ymdAlmatyFromIso(lead.createdAt);
    if (!ymd || !inRange(ymd)) continue;
    get(ymd).crmLeads += 1;
  }

  // Unique lead per day — повторный переход в joined_group не двоит день.
  const joinedDay = new Set<string>();
  for (const ev of stageEvents) {
    if (ev.cabinetId !== cabinetId) continue;
    if (!isGroupJoinStageKey(ev.toStageKey)) continue;
    const ymd = ymdAlmatyFromIso(ev.at);
    if (!ymd || !inRange(ymd)) continue;
    const key = `${ymd}:${ev.leadId}`;
    if (joinedDay.has(key)) continue;
    joinedDay.add(key);
    get(ymd).joins += 1;
  }

  return m;
}

export function sumAdsCabinetCrmDaily(byDay: Map<string, AdsCabinetCrmDay>): AdsCabinetCrmDay {
  let crmLeads = 0;
  let joins = 0;
  for (const d of byDay.values()) {
    crmLeads += d.crmLeads;
    joins += d.joins;
  }
  return { crmLeads, joins };
}
