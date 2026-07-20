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

function formatMonthShort(from: Date): string {
  return `${MONTHS_RU[from.getMonth()]} ${from.getFullYear()}`;
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
        "inline-flex max-w-full items-center gap-0.5 rounded-2xl border border-border/60 bg-card/60 px-1 py-1 sm:gap-1 sm:px-2 sm:py-1.5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => shiftMonth(-1)}
        className="grid h-9 w-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:w-9"
        aria-label="Предыдущий месяц"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 max-w-[7.5rem] items-center gap-1.5 rounded-xl px-2 py-1 text-sm font-semibold tabular-nums transition-colors hover:bg-secondary sm:max-w-none sm:gap-2 sm:px-3"
            aria-label="Выбрать месяц"
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate sm:hidden">{formatMonthShort(range.from)}</span>
            <span className="hidden truncate sm:inline">{formatMonthLabel(range.from)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center" sideOffset={8}>
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
        className="grid h-9 w-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:w-9"
        aria-label="Следующий месяц"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
