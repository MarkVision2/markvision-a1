import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  publishingApi,
  runHealthCheck,
  type AccountUpdateInput,
  type GroupUpsertInput,
  type MetricsResponse,
  type PersonaUpsertInput,
  type PublishAccount,
  type PublishGroup,
  type PublishJob,
  type PublishJobStatus,
  type PublishSettings,
  type PublishVideoInput,
  type ProjectRole,
  type Persona,
  type SettingsUpsertInput,
} from "@/lib/publishingClient";

/**
 * Состояние страницы «Публикации» по активному проекту: аккаунты, группы,
 * персоны, настройки, метрики и задания. Мутации оборачивают клиент и после
 * успеха перечитывают данные; `busy` — имя действия, которое сейчас идёт.
 */
export function usePublishing() {
  const { activeId: projectId } = useProjectsStore();

  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [groups, setGroups] = useState<PublishGroup[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [settings, setSettings] = useState<PublishSettings | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [jobsStatus, setJobsStatus] = useState<PublishJobStatus | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  const firstJobsEffect = useRef(true);

  const fetchJobs = useCallback(
    async (status: PublishJobStatus | "all" = jobsStatus) => {
      if (!projectId) return;
      const r = await publishingApi.jobsList(projectId, status === "all" ? { limit: 200 } : { status, limit: 200 });
      if (alive.current) setJobs(r.jobs ?? []);
    },
    [projectId, jobsStatus],
  );

  const refetch = useCallback(async () => {
    if (!projectId) {
      setAccounts([]);
      setGroups([]);
      setPersonas([]);
      setSettings(null);
      setMetrics(null);
      setJobs([]);
      setRole(null);
      return;
    }
    setLoading(true);
    try {
      // Каждый источник — независимо: ошибка одного не должна прятать остальные.
      const [a, g, p, s, m] = await Promise.allSettled([
        publishingApi.list(projectId),
        publishingApi.groupList(projectId),
        publishingApi.personaList(projectId),
        publishingApi.settingsGet(projectId),
        publishingApi.metrics(projectId),
      ]);
      if (!alive.current) return;
      // Отказ источника обнуляет его данные: иначе после смены проекта на экране
      // оставалась сеть аккаунтов прошлого проекта под баннером ошибки.
      setAccounts(a.status === "fulfilled" ? a.value.accounts ?? [] : []);
      setRole(a.status === "fulfilled" ? a.value.role ?? null : null);
      setGroups(g.status === "fulfilled" ? g.value.groups ?? [] : []);
      setPersonas(p.status === "fulfilled" ? p.value.personas ?? [] : []);
      setSettings(s.status === "fulfilled" ? s.value : null);
      setMetrics(m.status === "fulfilled" ? m.value : null);
      const failed = [a, g, p, s, m].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      setError(failed ? (failed.reason instanceof Error ? failed.reason.message : "Ошибка загрузки") : null);
      await fetchJobs().catch(() => undefined);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [projectId, fetchJobs]);

  useEffect(() => {
    alive.current = true;
    void refetch();
    return () => {
      alive.current = false;
    };
  }, [projectId]);

  // Смена фильтра заданий — перечитываем только задания (первый рендер уже покрыт refetch).
  useEffect(() => {
    if (firstJobsEffect.current) { firstJobsEffect.current = false; return; }
    if (!projectId) return;
    void fetchJobs(jobsStatus).catch(() => undefined);
  }, [jobsStatus]);

  const act = useCallback(
    async <T>(name: string, fn: (pid: string) => Promise<T>, reload = true): Promise<T> => {
      if (!projectId) throw new Error("Выберите проект");
      setBusy(name);
      try {
        const r = await fn(projectId);
        if (reload) await refetch();
        return r;
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [projectId, refetch],
  );

  return {
    projectId,
    accounts,
    groups,
    personas,
    settings,
    metrics,
    jobs,
    /** Роль пользователя в проекте (RBAC): интерфейс прячет действия не по роли, сервер решает окончательно. */
    role,
    jobsStatus,
    setJobsStatus,
    loading,
    error,
    busy,
    refetch,

    // Мутации — возвращают ответ функции и перечитывают состояние.
    loadAvailable: (metaToken?: string | null) => act("available", (pid) => publishingApi.available(pid, metaToken), false),
    connect: (pageIds: string[], metaToken?: string | null, groupId?: string | null) =>
      act("connect", (pid) => publishingApi.connect(pid, pageIds, metaToken, groupId)),
    connectThreads: (input: { threads_user_id: string; access_token: string; account_name?: string; group_id?: string }) =>
      act("connect_threads", (pid) => publishingApi.connectThreads(pid, input)),
    updateAccount: (accountId: string, patch: AccountUpdateInput) =>
      act(`update:${accountId}`, (pid) => publishingApi.update(pid, accountId, patch)),
    /** Без перечитывания — для массовых правок, где refetch делается один раз в конце. */
    updateAccountQuiet: (accountId: string, patch: AccountUpdateInput) =>
      act(`update:${accountId}`, (pid) => publishingApi.update(pid, accountId, patch), false),
    disconnect: (accountId: string) => act(`disconnect:${accountId}`, (pid) => publishingApi.disconnect(pid, accountId)),
    groupUpsert: (input: GroupUpsertInput) => act("group_upsert", (pid) => publishingApi.groupUpsert(pid, input)),
    groupDelete: (groupId: string) => act("group_delete", (pid) => publishingApi.groupDelete(pid, groupId)),
    personaUpsert: (input: PersonaUpsertInput) => act("persona_upsert", (pid) => publishingApi.personaUpsert(pid, input)),
    personaDelete: (personaId: string) => act("persona_delete", (pid) => publishingApi.personaDelete(pid, personaId)),
    settingsUpsert: (input: SettingsUpsertInput) => act("settings_upsert", (pid) => publishingApi.settingsUpsert(pid, input)),
    publishVideo: (input: PublishVideoInput) => act("publish_video", (pid) => publishingApi.publishVideo(pid, input)),
    healthCheck: (accountIds?: string[]) => act("health_check", (pid) => runHealthCheck(pid, accountIds)),
    jobRetry: (jobId: string) => act(`job_retry:${jobId}`, (pid) => publishingApi.jobRetry(pid, jobId)),
    jobCancel: (jobId: string) => act(`job_cancel:${jobId}`, (pid) => publishingApi.jobCancel(pid, jobId)),
  };
}

export type UsePublishing = ReturnType<typeof usePublishing>;
