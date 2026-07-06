import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import {
  formatPeriodLabel,
  monthRange,
  todayRange,
  weekRange,
  type MetricsPeriodPreset,
} from "@/lib/metricsPeriod";
import { cn } from "@/lib/utils";

const PRESETS: { id: MetricsPeriodPreset; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "custom", label: "Произвольный" },
];

interface Props {
  preset: MetricsPeriodPreset;
  range: ReportPeriodRange;
  onPresetChange: (preset: MetricsPeriodPreset, range: ReportPeriodRange) => void;
  className?: string;
}

export function MetricsPeriodPicker({ preset, range, onPresetChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: Date; to?: Date }>({});

  const applyPreset = (id: MetricsPeriodPreset) => {
    if (id === "today") onPresetChange("today", todayRange());
    else if (id === "week") onPresetChange("week", weekRange());
    else if (id === "month") onPresetChange("month", monthRange());
    else {
      setDraft({ from: range.from, to: range.to });
      onPresetChange("custom", range);
    }
  };

  const applyCustom = () => {
    if (!draft.from || !draft.to) return;
    const from = draft.from <= draft.to ? draft.from : draft.to;
    const to = draft.from <= draft.to ? draft.to : draft.from;
    onPresetChange("custom", { from, to });
    setOpen(false);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="inline-flex rounded-2xl border border-border/60 bg-card/60 p-0.5">
        {PRESETS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => applyPreset(id)}
            className={cn(
              "rounded-xl px-3 py-2 text-xs font-medium transition-colors",
              preset === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-3 py-2 text-xs font-semibold tabular-nums transition-colors hover:bg-secondary"
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              {formatPeriodLabel(range)}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex flex-col gap-3 p-3 sm:flex-row">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">С</div>
                <Calendar
                  mode="single"
                  selected={draft.from ?? range.from}
                  onSelect={(d) => setDraft((prev) => ({ ...prev, from: d ?? undefined }))}
                  initialFocus
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">По</div>
                <Calendar
                  mode="single"
                  selected={draft.to ?? range.to}
                  onSelect={(d) => setDraft((prev) => ({ ...prev, to: d ?? undefined }))}
                />
              </div>
            </div>
            <div className="border-t border-border/60 p-3">
              <button
                type="button"
                onClick={applyCustom}
                disabled={!draft.from || !draft.to}
                className="w-full rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                Применить
              </button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {preset !== "custom" && (
        <span className="text-xs text-muted-foreground tabular-nums">{formatPeriodLabel(range)}</span>
      )}
    </div>
  );
}
