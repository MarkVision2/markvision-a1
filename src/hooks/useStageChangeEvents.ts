import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ReportPeriodRange } from "@/lib/crmDailyMetrics";
import { ymdLocal } from "@/lib/metricsPeriod";

export interface StageChangeEvent {
  leadId: string;
  cabinetId: string | null;
  at: string;
  toStageKey: string;
  isDiagnostic: boolean;
}

async function fetchStageChangeEvents(
  activeId: string | null,
  range: ReportPeriodRange,
): Promise<StageChangeEvent[]> {
  const since = `${ymdLocal(range.from)}T00:00:00`;
  const until = new Date(range.to);
  until.setDate(until.getDate() + 1);
  const untilIso = `${ymdLocal(until)}T00:00:00`;

  const [stagesRes, eventsRes] = await Promise.all([
    supabase.from("pipeline_stages").select("id,key,is_diagnostic"),
    (() => {
      const q = supabase
        .from("events")
        .select("lead_id,created_at,payload")
        .eq("event_type", "stage_changed")
        .gte("created_at", since)
        .lt("created_at", untilIso)
        .order("created_at", { ascending: true })
        .limit(20000);
      return q;
    })(),
  ]);

  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const stageById = new Map<string, { key: string; isDiagnostic: boolean }>();
  for (const s of stagesRes.data ?? []) {
    stageById.set(s.id, {
      key: String(s.key ?? "").toLowerCase(),
      isDiagnostic: Boolean(s.is_diagnostic),
    });
  }

  const stageMeta = (toId: string, payload: { to_key?: string; to_is_diagnostic?: boolean } | null) => {
    const fromPayload = payload?.to_key ? String(payload.to_key).toLowerCase() : null;
    const stage = stageById.get(toId);
    return {
      key: fromPayload ?? stage?.key ?? "",
      isDiagnostic: payload?.to_is_diagnostic ?? stage?.isDiagnostic ?? false,
    };
  };

  const leadIds = [...new Set((eventsRes.data ?? []).map((e) => e.lead_id as string))];
  if (leadIds.length === 0) return [];

  let leadsQuery = supabase
    .from("leads")
    .select("id,cabinet_id,project_id")
    .in("id", leadIds)
    .eq("is_personal", false);
  if (activeId) {
    leadsQuery = leadsQuery.or(`project_id.eq.${activeId},project_id.is.null`);
  }
  const { data: leadsData, error: leadsError } = await leadsQuery;
  if (leadsError) throw new Error(leadsError.message);

  const leadCabinet = new Map<string, string | null>();
  for (const l of leadsData ?? []) {
    leadCabinet.set(l.id as string, (l.cabinet_id as string | null) ?? null);
  }

  const out: StageChangeEvent[] = [];
  for (const e of eventsRes.data ?? []) {
    const leadId = e.lead_id as string;
    if (!leadCabinet.has(leadId)) continue;
    const payload = e.payload as { to?: string; to_key?: string; to_is_diagnostic?: boolean } | null;
    const toId = payload?.to;
    if (!toId) continue;
    const meta = stageMeta(toId, payload);
    if (!meta.key) continue;
    out.push({
      leadId,
      cabinetId: leadCabinet.get(leadId) ?? null,
      at: e.created_at as string,
      toStageKey: meta.key,
      isDiagnostic: meta.isDiagnostic,
    });
  }
  return out;
}

export function useStageChangeEvents(range: ReportPeriodRange, enabled = true) {
  const { activeId } = useProjectsStore();
  const [events, setEvents] = useState<StageChangeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setEvents([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStageChangeEvents(activeId, range);
      setEvents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить события");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [activeId, range.from.getTime(), range.to.getTime(), enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { events, loading, error, refetch };
}
