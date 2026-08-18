import { useMemo } from "react";
import { RotateCcw, TableProperties } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useMetricLabels } from "@/hooks/useMetricLabels";
import { METRIC_COLUMNS, DEFAULT_METRIC_LABEL, type MetricColumnKey } from "@/lib/metricColumns";

export function MetricLabelsSettings() {
  const { isAdmin } = useAuth();
  const { active } = useProjectsStore();
  const { overrides, saveLabel, projectId } = useMetricLabels();

  const groups = useMemo(
    () => Array.from(new Set(METRIC_COLUMNS.map((c) => c.group))),
    [],
  );

  const commit = async (key: MetricColumnKey, value: string) => {
    if (!isAdmin) return;
    const current = overrides[key] ?? "";
    if (value.trim() === current.trim()) return;
    try {
      await saveLabel(key, value);
      toast({ title: "Название сохранено" });
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: e instanceof Error ? e.message : "Ошибка",
        variant: "destructive",
      });
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-success/15 text-success">
          <TableProperties className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Названия столбцов «Таблицы показателей»</h2>
          <p className="text-xs text-muted-foreground">
            Переименуй столбцы под свою нишу для проекта{" "}
            <span className="font-medium text-foreground">{active?.name ?? "—"}</span>. Логика расчёта не меняется.
          </p>
        </div>
      </div>

      {!projectId ? (
        <p className="text-sm text-muted-foreground">Сначала выберите проект.</p>
      ) : (
        <div key={projectId} className="space-y-6">
          {groups.map((group) => (
            <div key={group} className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{group}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {METRIC_COLUMNS.filter((c) => c.group === group).map((c) => {
                  const value = overrides[c.key] ?? "";
                  return (
                    <div key={c.key} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        По умолчанию: {DEFAULT_METRIC_LABEL[c.key]}
                      </Label>
                      <div className="relative">
                        <Input
                          key={`${c.key}:${value}`}
                          defaultValue={value}
                          placeholder={DEFAULT_METRIC_LABEL[c.key]}
                          disabled={!isAdmin}
                          onBlur={(e) => commit(c.key, e.target.value)}
                          className="pr-9"
                        />
                        {value && isAdmin && (
                          <button
                            type="button"
                            title="Сбросить к названию по умолчанию"
                            onClick={() => commit(c.key, "")}
                            className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-secondary"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">Изменять названия может только администратор.</p>
          )}
        </div>
      )}
    </section>
  );
}
