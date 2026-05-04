import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getPresetRange, type PeriodPreset } from "@/hooks/useDashboardData";
import type { ReportPeriodRange } from "@/hooks/useReportData";

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "7d", label: "7 дней" },
  { id: "30d", label: "30 дней" },
  { id: "month", label: "Месяц" },
];

interface Props {
  preset: PeriodPreset;
  range: ReportPeriodRange;
  onChange: (preset: PeriodPreset, range: ReportPeriodRange) => void;
}

export function PeriodPicker({ preset, range, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-card/60 p-1">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id, getPresetRange(p.id))}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            preset === p.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary",
          )}
        >
          {p.label}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 rounded-lg px-3 text-xs font-medium",
              preset === "custom" && "bg-primary text-primary-foreground",
            )}
          >
            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
            {preset === "custom"
              ? `${format(range.from, "d MMM", { locale: ru })} – ${format(range.to, "d MMM", { locale: ru })}`
              : "Свой период"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={{ from: range.from, to: range.to }}
            onSelect={(r) => {
              if (r?.from && r?.to) {
                onChange("custom", { from: r.from, to: r.to });
                setOpen(false);
              }
            }}
            numberOfMonths={2}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}