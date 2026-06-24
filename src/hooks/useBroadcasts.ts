import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  createBroadcast,
  readBroadcasts,
  removeBroadcast,
  subscribeBroadcasts,
  updateBroadcast,
  type Broadcast,
  type BroadcastContact,
  type BroadcastDraft,
} from "@/lib/broadcastStore";
import type { LeadContact } from "@/hooks/useLeadContacts";

/** Реактивный доступ к рассылкам активного проекта (localStorage). */
export function useBroadcasts(projectId: string | null) {
  const broadcasts = useSyncExternalStore(
    subscribeBroadcasts,
    () => readBroadcasts(projectId),
    () => readBroadcasts(projectId),
  );

  const create = useCallback((draft: BroadcastDraft) => createBroadcast(projectId, draft), [projectId]);
  const update = useCallback(
    (id: string, patch: Partial<Broadcast>) => updateBroadcast(projectId, id, patch),
    [projectId],
  );
  const remove = useCallback((id: string) => removeBroadcast(projectId, id), [projectId]);

  const stats = useMemo(() => summarizeBroadcasts(broadcasts), [broadcasts]);

  return { broadcasts, stats, create, update, remove };
}

export function summarizeBroadcasts(list: Broadcast[]) {
  const sent = list.filter((b) => b.status === "sent" || b.status === "partial");
  const scheduled = list.filter((b) => b.status === "scheduled").length;
  const reached = list.reduce((s, b) => s + b.stats.sent, 0);
  return {
    total: list.length,
    sent: sent.length,
    scheduled,
    reached,
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
