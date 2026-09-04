import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import {
  contentPipelineApi,
  isActivePipelineState,
  type PipelineDetail,
} from "@/lib/contentPipeline";

const ACTIVE_POLL_MS = 15_000;

/**
 * Состояние контент-конвейера по одной теме. Источник правды — база через
 * edge-функцию (GET /items/:id): при повторном открытии страницы карточка
 * получает актуальный этап, а не то, что помнил браузер. Пока запуск активен —
 * опрос раз в 15 с плюс realtime по pipeline_runs.
 */
export function useContentPipeline(itemId: string | undefined, enabled = true) {
  const [detail, setDetail] = useState<PipelineDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true);

  const refetch = useCallback(async () => {
    if (!itemId || !enabled) return;
    setLoading(true);
    try {
      const d = await contentPipelineApi.get(itemId);
      if (alive.current) {
        setDetail(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [itemId, enabled]);

  useEffect(() => {
    alive.current = true;
    void refetch();
    return () => {
      alive.current = false;
    };
  }, [refetch]);

  const active = isActivePipelineState(detail?.current_run?.state);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refetch(), ACTIVE_POLL_MS);
    return () => clearInterval(t);
  }, [active, refetch]);

  useRealtimeTable("pipeline_runs", () => void refetch(), !!itemId && enabled, 800);

  const act = useCallback(
    async (name: string, fn: () => Promise<PipelineDetail>) => {
      setBusy(name);
      try {
        const d = await fn();
        if (alive.current) setDetail(d);
        return d;
      } finally {
        if (alive.current) setBusy(null);
      }
    },
    [],
  );

  return {
    detail,
    loading,
    error,
    busy,
    refetch,
    generate: () => act("generate", () => contentPipelineApi.generate(itemId!)),
    approve: () => act("approve", () => contentPipelineApi.review(itemId!, "approved")),
    reject: (comment: string) => act("reject", () => contentPipelineApi.review(itemId!, "rejected", comment)),
    retry: (comment?: string) => act("retry", () => contentPipelineApi.retry(itemId!, comment)),
    cancel: () => act("cancel", () => contentPipelineApi.cancel(itemId!)),
  };
}
