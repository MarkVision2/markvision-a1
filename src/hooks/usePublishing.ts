import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  publishingApi,
  runHealthCheck,
  type AccountUpdateInput,
  type GroupUpsertInput,
  type JobCounts,
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
const JOBS_PAGE = 200;
/** Потолок publish-accounts jobs_list. */
const JOBS_MAX = 500;

export function usePublishing() {
  const { activeId: projectId } = useProjectsStore();

  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [groups, setGroups] = useState<PublishGroup[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [settings, setSettings] = useState<PublishSettings | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  // Счётчики по всей очереди — чипы фильтра врали, считая только загруженную страницу.
  const [jobCounts, setJobCounts] = useState<JobCounts>({});
  const [role, setRole] = useState<ProjectRole | null>(null);
  const [jobsStatus, setJobsStatusRaw] = useState<PublishJobStatus | "all">("all");
  // Страница заданий: сервер отдаёт до 500, начинаем с 200 и подгружаем по кнопке.
  const [jobsLimit, setJobsLimit] = useState(JOBS_PAGE);
  // Фильтр «задания этого видео» — из вкладки «Видео».
  const [jobsVideo, setJobsVideoRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const alive = useRef(true);
  const firstJobsEffect = useRef(true);
  // Номера запросов: медленный ответ по прошлому проекту или прошлому фильтру
  // не должен перетирать свежие данные (alive один на все запросы и этого не ловит).
  const loadSeq = useRef(0);
  const jobsSeq = useRef(0);

  const fetchJobs = useCallback(
    async (status: PublishJobStatus | "all" = jobsStatus, limit: number = jobsLimit, videoId: string | null = jobsVideo) => {
      if (!projectId) return;
      const seq = ++jobsSeq.current;
      setJobsLoading(true);
      try {
        const r = await publishingApi.jobsList(projectId, {
          limit,
          ...(status === "all" ? {} : { status }),
          ...(videoId ? { video_id: videoId } : {}),
        });
        // Счётчики приходят тем же ответом — устаревшая выборка не должна
        // перетирать чипы фильтра числами от прошлого запроса.
        if (alive.current && seq === jobsSeq.current) {
          setJobs(r.jobs ?? []);
          setJobCounts(r.counts ?? {});
        }
      } finally {
        if (alive.current && seq === jobsSeq.current) setJobsLoading(false);
      }
    },
    [projectId, jobsStatus, jobsLimit, jobsVideo],
  );

  // jobsOverride — фильтры очереди для этого чтения (смена проекта сбрасывает их,
  // а замыкание fetchJobs ещё помнит старые). Без аргумента — текущие фильтры;
  // не-массив игнорируем: refetch иногда висит прямо на onClick и получает событие.
  const refetch = useCallback(async (jobsOverride?: unknown) => {
    if (!projectId) {
      setAccounts([]);
      setGroups([]);
      setPersonas([]);
      setSettings(null);
      setMetrics(null);
      setJobs([]);
      setJobCounts({});
      setRole(null);
      return;
    }
    setLoading(true);
    const seq = ++loadSeq.current;
    try {
      // Каждый источник — независимо: ошибка одного не должна прятать остальные.
      const [a, g, p, s, m] = await Promise.allSettled([
        publishingApi.list(projectId),
        publishingApi.groupList(projectId),
        publishingApi.personaList(projectId),
        publishingApi.settingsGet(projectId),
        publishingApi.metrics(projectId),
      ]);
      if (!alive.current || seq !== loadSeq.current) return;
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
      const jobsArgs = Array.isArray(jobsOverride)
        ? (jobsOverride as [PublishJobStatus | "all", number, string | null])
        : ([] as unknown as [PublishJobStatus | "all", number, string | null]);
      await fetchJobs(...jobsArgs).catch((e) => { if (alive.current) setError(e instanceof Error ? e.message : "Ошибка загрузки заданий"); });
    } finally {
      if (alive.current && seq === loadSeq.current) setLoading(false);
    }
  }, [projectId, fetchJobs]);

  useEffect(() => {
    alive.current = true;
    // Фильтры очереди — от прошлого проекта: его видео и статус к новому не относятся.
    setJobsStatusRaw("all");
    setJobsVideoRaw(null);
    setJobsLimit(JOBS_PAGE);
    void refetch(["all", JOBS_PAGE, null]);
    return () => {
      alive.current = false;
    };
  }, [projectId]);

  // Смена фильтра заданий — перечитываем только задания (первый рендер уже покрыт refetch).
  // Старые строки убираем сразу: иначе под новым чипом видна прошлая выборка.
  useEffect(() => {
    if (firstJobsEffect.current) { firstJobsEffect.current = false; return; }
    if (!projectId) return;
    setJobs([]);
    void fetchJobs(jobsStatus, jobsLimit, jobsVideo).catch((e) => { if (alive.current) setError(e instanceof Error ? e.message : "Ошибка загрузки заданий"); });
  }, [jobsStatus, jobsLimit, jobsVideo]);

  // Новый фильтр — снова первая страница, иначе подгруженный хвост прилипает к другому статусу.
  const setJobsStatus = useCallback((s: PublishJobStatus | "all") => { setJobsStatusRaw(s); setJobsLimit(JOBS_PAGE); }, []);
  const setJobsVideo = useCallback((id: string | null) => { setJobsVideoRaw(id); setJobsLimit(JOBS_PAGE); }, []);
  const loadMoreJobs = useCallback(() => setJobsLimit((l) => Math.min(l + JOBS_PAGE, JOBS_MAX)), []);

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
    jobCounts,
    /** Роль пользователя в проекте (RBAC): интерфейс прячет действия не по роли, сервер решает окончательно. */
    role,
    jobsStatus,
    setJobsStatus,
    jobsLimit,
    jobsVideo,
    setJobsVideo,
    /** Есть ли смысл в «Показать ещё»: выборка упёрлась в лимит и потолок сервера не достигнут. */
    jobsHasMore: jobs.length >= jobsLimit && jobsLimit < JOBS_MAX,
    loadMoreJobs,
    jobsLoading,
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
    jobsRetryFailed: (videoId?: string | null) => act("jobs_retry_failed", (pid) => publishingApi.jobsRetryFailed(pid, videoId)),
    videoDelete: (videoId: string, force = false) => act(`video_delete:${videoId}`, (pid) => publishingApi.videoDelete(pid, videoId, force)),
    /** Без перечитывания: ничего не меняет, только проверяет доставку. */
    notifyTest: () => act("notify_test", (pid) => publishingApi.notifyTest(pid), false),
  };
}

export type UsePublishing = ReturnType<typeof usePublishing>;
