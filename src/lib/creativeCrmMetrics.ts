import { isLeadDiagnosticEvent, isLeadPaid, type LeadFlagsInput } from "@/lib/leadStageFlags";

export interface CreativeCrmAgg {
  crmLeads: number;
  crmQualified: number;
  crmSales: number;
  crmDiagnostics: number;
  crmRevenue: number;
}

export const EMPTY_CREATIVE_CRM: CreativeCrmAgg = {
  crmLeads: 0,
  crmQualified: 0,
  crmSales: 0,
  crmDiagnostics: 0,
  crmRevenue: 0,
};

export interface LeadForCreativeCrm extends LeadFlagsInput {
  metaAdId?: string | null;
  createdAt: string;
  paidAt?: string | null;
  lastActivityAt?: string;
}

function inHalfOpenRange(ts: number, sinceTs: number, untilTs: number) {
  return ts >= sinceTs && ts < untilTs;
}

/** CRM-метрики по meta_ad_id за период — та же семантика, что Dashboard / CreativeFunnel. */
export function aggregateCreativeCrmFromLeads(
  leads: LeadForCreativeCrm[],
  range: { from: Date; to: Date },
): Map<string, CreativeCrmAgg> {
  const sinceTs = range.from.getTime();
  const untilTs = new Date(
    range.to.getFullYear(),
    range.to.getMonth(),
    range.to.getDate() + 1,
  ).getTime();
  const out = new Map<string, CreativeCrmAgg>();

  const bump = (adId: string, patch: Partial<CreativeCrmAgg>) => {
    const cur = out.get(adId) ?? { ...EMPTY_CREATIVE_CRM };
    cur.crmLeads += patch.crmLeads ?? 0;
    cur.crmQualified += patch.crmQualified ?? 0;
    cur.crmSales += patch.crmSales ?? 0;
    cur.crmDiagnostics += patch.crmDiagnostics ?? 0;
    cur.crmRevenue += patch.crmRevenue ?? 0;
    out.set(adId, cur);
  };

  for (const l of leads) {
    const adId = l.metaAdId?.trim();
    if (!adId) continue;

    const createdTs = new Date(l.createdAt).getTime();
    if (inHalfOpenRange(createdTs, sinceTs, untilTs)) {
      bump(adId, { crmLeads: 1 });
      if (isLeadDiagnosticEvent(l) || isLeadPaid(l)) {
        bump(adId, { crmQualified: 1 });
      }
    }

    if (isLeadPaid(l)) {
      const paidAt = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(paidAt).getTime();
      if (inHalfOpenRange(t, sinceTs, untilTs)) {
        bump(adId, {
          crmSales: 1,
          crmRevenue: (Number(l.amount) || 0) + (Number(l.diagnosticAmount) || 0),
        });
        bump(adId, { crmDiagnostics: 1 });
      }
    } else if (isLeadDiagnosticEvent(l)) {
      const ref = l.paidAt ?? l.lastActivityAt ?? l.createdAt;
      const t = new Date(ref).getTime();
      if (inHalfOpenRange(t, sinceTs, untilTs)) {
        bump(adId, {
          crmDiagnostics: 1,
          crmRevenue: Number(l.diagnosticAmount) || 0,
        });
      }
    }
  }

  return out;
}

export interface RawCreativeCrmDailyRow {
  ad_id: string;
  crm_leads?: number | string | null;
  crm_qualified?: number | string | null;
  crm_sales?: number | string | null;
  crm_diagnostics?: number | string | null;
  crm_revenue?: number | string | null;
  crm_diagnostic_revenue?: number | string | null;
}

/** Агрегация meta_creative_crm_daily: выручка = продажи + диагностики. */
export function aggregateCreativeCrmFromDaily(
  rows: RawCreativeCrmDailyRow[],
): Map<string, CreativeCrmAgg> {
  const out = new Map<string, CreativeCrmAgg>();
  for (const c of rows) {
    const cur = out.get(c.ad_id) ?? { ...EMPTY_CREATIVE_CRM };
    cur.crmLeads += Number(c.crm_leads) || 0;
    cur.crmQualified += Number(c.crm_qualified) || 0;
    cur.crmSales += Number(c.crm_sales) || 0;
    cur.crmDiagnostics += Number(c.crm_diagnostics) || 0;
    const salesRev = Number(c.crm_revenue) || 0;
    const diagRev = Number(c.crm_diagnostic_revenue) || 0;
    cur.crmRevenue += salesRev + diagRev;
    out.set(c.ad_id, cur);
  }
  return out;
}

/**
 * Объединяет view и прямую атрибуцию из leads.
 * Берём максимум по каждой метрике — view учитывает phone_attribution,
 * leads закрывает пропуски, когда view ещё не обновился.
 */
export function mergeCreativeCrmMaps(
  primary: Map<string, CreativeCrmAgg>,
  secondary: Map<string, CreativeCrmAgg>,
): Map<string, CreativeCrmAgg> {
  const out = new Map(primary);
  for (const [adId, sec] of secondary) {
    const cur = out.get(adId) ?? { ...EMPTY_CREATIVE_CRM };
    out.set(adId, {
      crmLeads: Math.max(cur.crmLeads, sec.crmLeads),
      crmQualified: Math.max(cur.crmQualified, sec.crmQualified),
      crmSales: Math.max(cur.crmSales, sec.crmSales),
      crmDiagnostics: Math.max(cur.crmDiagnostics, sec.crmDiagnostics),
      crmRevenue: Math.max(cur.crmRevenue, sec.crmRevenue),
    });
  }
  return out;
}
