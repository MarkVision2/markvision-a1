import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type { Lead } from "@/types/crm";

type SyncableLead = Pick<Lead, "id" | "cabinetId" | "createdAt" | "paidAt" | "paid" | "stageId">;

const DIAGNOSTIC_STAGE_KEYS = new Set(["scheduled", "visit", "paid", "completed", "diagnosed"]);

function ymdFromIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayBounds(date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function uniqueDates(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(ymdFromIso).filter(Boolean) as string[]));
}

async function getDiagnosticStageIds() {
  const { data } = await supabase
    .from("pipeline_stages")
    .select("id,key,is_diagnostic");
  return (data ?? [])
    .filter((s) => Boolean((s as { is_diagnostic?: boolean | null }).is_diagnostic) || DIAGNOSTIC_STAGE_KEYS.has(String(s.key ?? "")))
    .map((s) => s.id as string);
}

async function recomputeCabinetDate(cabinetId: string, projectId: string | null | undefined, date: string) {
  const { data: cabinet, error: cabinetError } = await supabase
    .from("ad_cabinets")
    .select("id,external_id,project_id,currency,provider")
    .eq("id", cabinetId)
    .maybeSingle();
  if (cabinetError || !cabinet?.external_id) return;

  const { startIso, endIso } = dayBounds(date);
  const scopedProjectId = projectId ?? (cabinet as { project_id?: string | null }).project_id ?? null;

  let paidQuery = supabase
    .from("leads")
    .select("id,amount")
    .eq("cabinet_id", cabinetId)
    .eq("is_personal", false)
    .eq("paid", true)
    .gte("paid_at", startIso)
    .lt("paid_at", endIso);
  if (scopedProjectId) {
    paidQuery = paidQuery.or(`project_id.eq.${scopedProjectId},project_id.is.null`);
  }
  const { data: paidLeads } = await paidQuery;

  const diagnosticStageIds = await getDiagnosticStageIds();
  let diagnostics = 0;
  if (diagnosticStageIds.length > 0) {
    let diagnosticQuery = supabase
      .from("leads")
      .select("id")
      .eq("cabinet_id", cabinetId)
      .eq("is_personal", false)
      .in("stage_id", diagnosticStageIds)
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    if (scopedProjectId) {
      diagnosticQuery = diagnosticQuery.or(`project_id.eq.${scopedProjectId},project_id.is.null`);
    }
    const { data: diagnosticLeads } = await diagnosticQuery;
    diagnostics = diagnosticLeads?.length ?? 0;
  }

  const crmSales = paidLeads?.length ?? 0;
  const crmRevenue = (paidLeads ?? []).reduce((sum, lead) => sum + (Number(lead.amount) || 0), 0);
  const syncedAt = new Date().toISOString();
  const update: TablesUpdate<"cabinet_daily_insights"> = {
    crm_sales: crmSales,
    crm_revenue: crmRevenue,
    crm_diagnostics: diagnostics,
    synced_at: syncedAt,
  };

  const { data: existing } = await supabase
    .from("cabinet_daily_insights")
    .select("id")
    .eq("cabinet_id", cabinetId)
    .eq("date", date);

  if (existing?.length) {
    await Promise.all(
      existing.map((row) => supabase.from("cabinet_daily_insights").update(update).eq("id", row.id)),
    );
    return;
  }

  const insert: TablesInsert<"cabinet_daily_insights"> = {
    cabinet_id: cabinetId,
    external_id: String(cabinet.external_id),
    project_id: scopedProjectId,
    provider: String((cabinet as { provider?: string | null }).provider ?? "meta"),
    currency: String((cabinet as { currency?: string | null }).currency ?? "KZT"),
    date,
    ...update,
  };
  await supabase.from("cabinet_daily_insights").insert(insert);
}

export async function syncLeadCrmFactsToInsights(params: {
  lead: SyncableLead | undefined;
  previousLead?: SyncableLead;
  projectId?: string | null;
  extraDates?: Array<string | null | undefined>;
}) {
  const { lead, previousLead, projectId, extraDates = [] } = params;
  const cabinetId = lead?.cabinetId ?? previousLead?.cabinetId;
  if (!cabinetId) return;

  const dates = uniqueDates([
    lead?.createdAt,
    previousLead?.createdAt,
    lead?.paidAt,
    previousLead?.paidAt,
    ...extraDates,
  ]);
  await Promise.all(dates.map((date) => recomputeCabinetDate(cabinetId, projectId, date)));
}
