import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCampaign,
  duplicateCampaign,
  launchCampaign,
  listCampaigns,
  removeCampaign,
  updateCampaign,
  type CreateCampaignOpts,
} from "@/lib/broadcastServer";
import { type Broadcast, type BroadcastContact, type BroadcastDraft } from "@/lib/broadcastStore";
import type { LeadContact } from "@/hooks/useLeadContacts";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export const BROADCASTS_QUERY_KEY = "broadcasts";

/**
 * Рассылки активного проекта из Supabase (broadcast_campaigns).
 * Реальную отправку делает edge broadcast-worker; здесь — CRUD + запуск,
 * прогресс подтягивается realtime-подпиской на таблицу кампаний.
 */
export function useBroadcasts(projectId: string | null, crmContacts: LeadContact[] = []) {
  const queryClient = useQueryClient();

  const { data: broadcasts = [] } = useQuery({
    queryKey: [BROADCASTS_QUERY_KEY, projectId],
    queryFn: () => (projectId ? listCampaigns(projectId) : Promise.resolve([])),
    enabled: !!projectId,
    // Пока идёт отправка / есть активные кампании — подтягиваем воронку без F5.
    refetchInterval: (q) => {
      const list = q.state.data ?? [];
      const live = list.some((b) => b.status === "sending" || b.status === "scheduled");
      return live ? 15_000 : 45_000;
    },
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [BROADCASTS_QUERY_KEY, projectId] });
  }, [queryClient, projectId]);

  useRealtimeTable("broadcast_campaigns", invalidate, !!projectId, 500);
  useRealtimeTable("broadcast_recipients", invalidate, !!projectId, 800);
  // CRM: посещение вебинара / оплата → сразу пересчитать воронку рассылок.
  useRealtimeTable("leads", invalidate, !!projectId, 1200);

  const create = useCallback(
    async (draft: BroadcastDraft, opts?: CreateCampaignOpts): Promise<Broadcast | null> => {
      if (!projectId) return null;
      const created = await createCampaign(projectId, draft, crmContacts, opts);
      invalidate();
      return created;
    },
    [projectId, crmContacts, invalidate],
  );

  const duplicate = useCallback(
    async (draft: BroadcastDraft): Promise<Broadcast | null> => {
      if (!projectId) return null;
      const created = await duplicateCampaign(projectId, draft, crmContacts);
      invalidate();
      return created;
    },
    [projectId, crmContacts, invalidate],
  );

  const update = useCallback(
    async (id: string, draft: BroadcastDraft) => {
      if (!projectId) return;
      await updateCampaign(projectId, id, draft, crmContacts);
      invalidate();
    },
    [projectId, crmContacts, invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      await removeCampaign(id);
      invalidate();
    },
    [invalidate],
  );

  const launch = useCallback(
    async (id: string) => {
      await launchCampaign(id);
      invalidate();
    },
    [invalidate],
  );

  const stats = useMemo(() => summarizeBroadcasts(broadcasts), [broadcasts]);

  return { broadcasts, stats, create, duplicate, update, remove, launch };
}

export function summarizeBroadcasts(list: Broadcast[]) {
  const sentCampaigns = list.filter((b) => b.status === "sent" || b.status === "partial");
  const scheduled = list.filter((b) => b.status === "scheduled").length;
  const sending = list.filter((b) => b.status === "sending").length;
  let reached = 0;
  let joined = 0;
  let webinarAttended = 0;
  let sales = 0;
  for (const b of list) {
    reached += b.stats.sent || 0;
    joined += b.stats.joined ?? 0;
    webinarAttended += b.stats.webinarAttended ?? 0;
    sales += b.stats.sales ?? b.stats.converted ?? 0;
  }
  return {
    total: list.length,
    sent: sentCampaigns.length,
    scheduled,
    sending,
    reached,
    joined,
    webinarAttended,
    sales,
  };
}

/** Превращает CRM-фильтр в список контактов из переданной базы CRM. */
export function filterCrmContacts(contacts: LeadContact[], stageKeys: string[], sources: string[]): BroadcastContact[] {
  const seen = new Set<string>();
  const out: BroadcastContact[] = [];
  for (const c of contacts) {
    if (stageKeys.length && !stageKeys.includes(c.stageKey)) continue;
    if (sources.length && !sources.includes(c.source || "—")) continue;
    const key = c.phone.replace(/\D/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: c.name, phone: c.phone });
  }
  return out;
}

/** Итоговый список получателей кампании (CRM-фильтр либо загруженные контакты). */
export function resolveRecipients(broadcast: Broadcast, crmContacts: LeadContact[]): BroadcastContact[] {
  if (broadcast.audienceSource === "upload") return broadcast.uploadedContacts;
  return filterCrmContacts(crmContacts, broadcast.crmFilter.stageKeys, broadcast.crmFilter.sources);
}
