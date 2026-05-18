import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const MONTHS_RU_SHORT = [
  "янв.",
  "фев.",
  "мар.",
  "апр.",
  "май",
  "июн.",
  "июл.",
  "авг.",
  "сен.",
  "окт.",
  "ноя.",
  "дек.",
];

export function normalizeMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function shiftMonth(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function monthParam(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyLabel(date: Date) {
  return `${MONTHS_RU[date.getMonth()]} ${date.getFullYear()}`;
}

export function monthRangeLabel(date: Date) {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const month = MONTHS_RU_SHORT[date.getMonth()];
  return `1 ${month} – ${lastDay} ${month} ${date.getFullYear()}`;
}

export function monthRange(date: Date): ReportPeriodRange {
  const from = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to };
}

interface MonthSwitcherProps {
  value: Date;
  onChange: (value: Date) => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

export function MonthSwitcher({
  value,
  onChange,
  className,
  size = "md",
  showIcon = true,
}: MonthSwitcherProps) {
  const month = normalizeMonth(value);
  const sizes = {
    sm: {
      wrap: "h-9 rounded-xl px-1",
      button: "h-7 w-7 rounded-lg",
      text: "min-w-[112px] px-1.5 text-xs",
      icon: "h-3.5 w-3.5",
    },
    md: {
      wrap: "h-11 rounded-2xl px-1.5",
      button: "h-8 w-8 rounded-xl",
      text: "min-w-[132px] px-2 text-sm",
      icon: "h-4 w-4",
    },
    lg: {
      wrap: "h-12 rounded-2xl px-1.5",
      button: "h-9 w-9 rounded-xl",
      text: "min-w-[146px] px-3 text-sm",
      icon: "h-4 w-4",
    },
  }[size];

  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-1 border border-border/60 bg-card/60 shadow-sm shadow-background/20",
        sizes.wrap,
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, -1))}
        className={cn(
          "grid place-items-center text-muted-foreground transition hover:bg-secondary hover:text-foreground",
          sizes.button,
        )}
        aria-label="Предыдущий месяц"
      >
        <ChevronLeft className={sizes.icon} />
      </button>
      <span
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold capitalize tabular-nums text-foreground",
          sizes.text,
        )}
      >
        {showIcon && <CalendarDays className={cn("text-muted-foreground", sizes.icon)} />}
        {monthKeyLabel(month)}
      </span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, 1))}
        className={cn(
          "grid place-items-center text-muted-foreground transition hover:bg-secondary hover:text-foreground",
          sizes.button,
        )}
        aria-label="Следующий месяц"
      >
        <ChevronRight className={sizes.icon} />
      </button>
    </div>
  );
}
