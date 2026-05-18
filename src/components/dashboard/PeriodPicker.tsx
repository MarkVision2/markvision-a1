import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ReportPeriodRange } from "@/hooks/useReportData";

const MONTHS_RU = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

export function monthRange(date: Date): ReportPeriodRange {
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from, to };
}

export function currentMonthRange(): ReportPeriodRange {
  return monthRange(new Date());
}

function formatMonthLabel(from: Date): string {
  const month = MONTHS_RU[from.getMonth()];
  const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  return `1 ${month}. – ${lastDay} ${month}. ${from.getFullYear()}`;
}

interface Props {
  range: ReportPeriodRange;
  onChange: (range: ReportPeriodRange) => void;
  className?: string;
}

export function PeriodPicker({ range, onChange, className }: Props) {
  const [open, setOpen] = useState(false);

  const shiftMonth = (delta: number) => {
    const next = new Date(range.from.getFullYear(), range.from.getMonth() + delta, 1);
    onChange(monthRange(next));
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-2xl border border-border/60 bg-card/60 px-2 py-1.5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => shiftMonth(-1)}
        className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label="Предыдущий месяц"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-xl px-3 py-1 text-sm font-semibold tabular-nums transition-colors hover:bg-secondary"
            aria-label="Выбрать месяц"
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            {formatMonthLabel(range.from)}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <Calendar
            mode="single"
            selected={range.from}
            onSelect={(date) => {
              if (date) {
                onChange(monthRange(date));
                setOpen(false);
              }
            }}
            defaultMonth={range.from}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onClick={() => shiftMonth(1)}
        className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label="Следующий месяц"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
