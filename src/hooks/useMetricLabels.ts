import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { DEFAULT_METRIC_LABEL, type MetricColumnKey } from "@/lib/metricColumns";

/**
 * Названия столбцов «Таблицы показателей» с учётом переопределений активного проекта.
 * `labelFor(key)` — кастомное название или дефолтное. `saveLabel` — upsert/сброс.
 */
export function useMetricLabels() {
  const { activeId } = useProjectsStore();
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const refetch = useCallback(async () => {
    if (!activeId) {
      setOverrides({});
      return;
    }
    const { data, error } = await supabase
      .from("project_metric_labels")
      .select("column_key, label")
      .eq("project_id", activeId);
    if (error) {
      setOverrides({});
      return;
    }
    const map: Record<string, string> = {};
    (data ?? []).forEach((r: { column_key: string; label: string }) => {
      if (r.label?.trim()) map[r.column_key] = r.label.trim();
    });
    setOverrides(map);
  }, [activeId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);
  useRealtimeTable("project_metric_labels", refetch, !!activeId);

  const labelFor = useCallback(
    (key: MetricColumnKey) => overrides[key] ?? DEFAULT_METRIC_LABEL[key],
    [overrides],
  );

  /** Сохранить название столбца. Пустое/дефолтное значение — удалить переопределение. */
  const saveLabel = useCallback(
    async (key: MetricColumnKey, rawLabel: string) => {
      if (!activeId) throw new Error("Не выбран проект");
      const label = rawLabel.trim();
      if (!label || label === DEFAULT_METRIC_LABEL[key]) {
        await supabase
          .from("project_metric_labels")
          .delete()
          .eq("project_id", activeId)
          .eq("column_key", key);
      } else {
        await supabase
          .from("project_metric_labels")
          .upsert(
            { project_id: activeId, column_key: key, label },
            { onConflict: "project_id,column_key" },
          );
      }
      await refetch();
    },
    [activeId, refetch],
  );

  return { labelFor, overrides, saveLabel, projectId: activeId };
}
