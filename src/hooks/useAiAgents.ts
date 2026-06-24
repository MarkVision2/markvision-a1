import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  createAgent,
  duplicateAgent,
  emptyAgentDraft,
  readAgents,
  removeAgent,
  setAgentStatus,
  subscribeAgents,
  updateAgent,
  type AgentDraft,
  type AgentStatus,
  type AiAgent,
} from "@/lib/aiAgentsStore";

/**
 * Реактивный доступ к ИИ-агентам активного проекта. Список переживает
 * перезагрузку (localStorage) и обновляется во всех вкладках компонентах
 * через подписку стора.
 */
export function useAiAgents(projectId: string | null) {
  const agents = useSyncExternalStore(
    subscribeAgents,
    () => readAgents(projectId),
    () => readAgents(projectId),
  );

  const create = useCallback((draft: AgentDraft) => createAgent(projectId, draft), [projectId]);
  const update = useCallback(
    (id: string, patch: Partial<AgentDraft>) => updateAgent(projectId, id, patch),
    [projectId],
  );
  const setStatus = useCallback(
    (id: string, status: AgentStatus) => setAgentStatus(projectId, id, status),
    [projectId],
  );
  const remove = useCallback((id: string) => removeAgent(projectId, id), [projectId]);
  const duplicate = useCallback((id: string) => duplicateAgent(projectId, id), [projectId]);

  const stats = useMemo(() => summarize(agents), [agents]);

  return { agents, stats, create, update, setStatus, remove, duplicate, emptyDraft: emptyAgentDraft };
}

export function summarize(agents: AiAgent[]) {
  const active = agents.filter((a) => a.status === "active").length;
  const paused = agents.filter((a) => a.status === "paused").length;
  const channels = new Set(agents.filter((a) => a.status === "active" && a.handle).map((a) => a.channel));
  const handled = agents.reduce((s, a) => s + a.stats.handled, 0);
  const resolved = agents.reduce((s, a) => s + a.stats.resolved, 0);
  const resolvedPct = handled > 0 ? (resolved / handled) * 100 : 0;
  return { total: agents.length, active, paused, connectedChannels: channels.size, handled, resolved, resolvedPct };
}
