// Лёгкий список контактов CRM для рассылок: только имя, телефон, этап и источник.
// Тянет минимум колонок из leads, кэшируется через React Query.
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface LeadContact {
  id: string;
  name: string;
  phone: string;
  source: string;
  stageKey: string;
}

export const LEAD_CONTACTS_QUERY_KEY = "lead-contacts";

export async function fetchLeadContacts(activeId: string | null): Promise<LeadContact[]> {
  let leadsQuery = supabase
    .from("leads")
    .select("id,name,phone,source,stage_id,created_at")
    .eq("is_personal", false)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (activeId) {
    leadsQuery = leadsQuery.or(`project_id.eq.${activeId},project_id.is.null`);
  }
  const [stagesRes, leadsRes] = await Promise.all([
    supabase.from("pipeline_stages").select("id,key"),
    leadsQuery,
  ]);
  const idToKey = new Map<string, string>();
  for (const s of stagesRes.data ?? []) idToKey.set(s.id as string, s.key as string);

  return (leadsRes.data ?? [])
    .map((r) => ({
      id: r.id as string,
      name: ((r.name as string) ?? "").trim(),
      phone: ((r.phone as string) ?? "").trim(),
      source: (r.source as string) ?? "",
      stageKey: idToKey.get(r.stage_id as string) ?? "new",
    }))
    .filter((c) => c.phone.length > 0);
}

export function useLeadContacts() {
  const { activeId } = useProjectsStore();
  const queryClient = useQueryClient();

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [LEAD_CONTACTS_QUERY_KEY, activeId] });
  }, [queryClient, activeId]);

  useRealtimeTable("leads", refetch, true, 600);

  const { data: contacts = [], isLoading: loading } = useQuery({
    queryKey: [LEAD_CONTACTS_QUERY_KEY, activeId],
    queryFn: () => fetchLeadContacts(activeId ?? null),
  });

  return { contacts, loading, refetch };
}
