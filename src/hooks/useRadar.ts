import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  radarApi,
  type IdeaPatch,
  type PromoteInput,
  type RadarOverview,
  type UpsertSourceInput,
} from "@/lib/radarClient";

/** Пока идёт сбор (запуск Apify) — опрос чаще: обзор сам дособирает результат. */
const CRAWL_POLL_MS = 15_000;
/** Пока есть посты в очереди разбора. */
const ANALYSIS_POLL_MS = 30_000;

const EMPTY: RadarOverview = { sources: [], metrics: null, ideas: [], posts: [], groups: [], runs: [], crawler: null };

/**
 * Обзор радара по активному проекту. Пока идёт сбор — опрос раз в 15 с, пока
 * есть посты в очереди разбора — раз в 30 с. Каждая мутация ждёт ответ
 * edge-функции и перечитывает обзор.
 */
export function useRadar() {
  const { activeId: projectId } = useProjectsStore();
  const [data, setData] = useState<RadarOverview>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);
  // Номер запроса: медленный ответ по прошлому проекту не должен перетереть свежий.
  const seqRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setData(EMPTY);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    try {
      const d = await radarApi.overview(projectId);
      if (alive.current && seq === seqRef.current) {
        setData({
          sources: d.sources ?? [],
          metrics: d.metrics ?? null,
          ideas: d.ideas ?? [],
          posts: d.posts ?? [],
          groups: d.groups ?? [],
          runs: d.runs ?? [],
          crawler: d.crawler ?? null,
        });
        setError(null);
      }
    } catch (e) {
      if (alive.current && seq === seqRef.current) setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      if (alive.current && seq === seqRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    alive.current = true;
    void refetch();
    return () => {
      alive.current = false;
    };
  }, [refetch]);

  const crawling = data.runs.some((r) => r.status === "running");
  const analyzing = data.posts.some((p) => p.analysis_status === "pending" || p.analysis_status === "analyzing");
  const pollMs = crawling ? CRAWL_POLL_MS : analyzing ? ANALYSIS_POLL_MS : 0;
  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => void refetch(), pollMs);
    return () => clearInterval(t);
  }, [pollMs, refetch]);

  const act = useCallback(
    async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
      setBusy(name);
      try {
        const r = await fn();
        await refetch();
        return r;
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [refetch],
  );

  return {
    projectId,
    ...data,
    loading,
    error,
    busy,
    crawling,
    refetch,
    upsertSource: (input: Omit<UpsertSourceInput, "project_id"> & { project_id?: string }) =>
      act("source", () => radarApi.upsertSource({ ...input, project_id: input.project_id ?? projectId })),
    deleteSource: (id: string) => act(`delete:${id}`, () => radarApi.deleteSource(id)),
    crawlSource: (id: string) => act(`crawl:${id}`, () => radarApi.crawlSource(id)),
    analyzeUrl: (url: string) => act("analyze-url", () => radarApi.analyzeUrl(projectId, url)),
    analyzePost: (id: string) => act(`analyze:${id}`, () => radarApi.analyzePost(id)),
    updateIdea: (id: string, patch: IdeaPatch) => act(`idea:${id}`, () => radarApi.updateIdea(id, patch)),
    promoteIdea: (id: string, input?: PromoteInput) => act(`promote:${id}`, () => radarApi.promoteIdea(id, input)),
  };
}

export type RadarState = ReturnType<typeof useRadar>;
