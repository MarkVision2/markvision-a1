import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

/**
 * Карта «ключ этапа (lowercase) → Meta CAPI событие» для активного проекта.
 * Проектные строки crm_stage_map перекрывают глобальные. Используется, чтобы
 * подсветить в воронке этапы, с которых уходят конверсии в Meta.
 */
export function useCapiStageMap(projectId?: string | null): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    if (!projectId) { setMap(new Map()); return; }
    const { data } = await (supabase.from("crm_stage_map" as any) as any)
      .select("status_key, capi_event, project_id")
      .or(`project_id.eq.${projectId},project_id.is.null`);
    const m = new Map<string, string>();
    for (const r of (data ?? []) as Array<{ status_key: string; capi_event: string; project_id: string | null }>) {
      const k = String(r.status_key).trim().toLowerCase();
      // Проектная строка в приоритете над глобальной.
      if (r.project_id === projectId || !m.has(k)) m.set(k, r.capi_event);
    }
    setMap(m);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeTable("crm_stage_map", () => void load());

  return map;
}
