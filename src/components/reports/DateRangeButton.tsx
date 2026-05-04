import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

interface Props {
  range: { from: Date; to: Date };
  onChange: (r: { from: Date; to: Date }) => void;
}

const PRESETS = [
  { id: "7d", label: "7 дней", days: 7 },
  { id: "30d", label: "30 дней", days: 30 },
  { id: "90d", label: "90 дней", days: 90 },
];

export function DateRangeButton({ range, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange | undefined>({
    from: range.from, to: range.to,
  });

  function apply(r: DateRange | undefined) {
    if (r?.from && r?.to) {
      onChange({ from: r.from, to: r.to });
      setOpen(false);
    }
  }

  const label = `${format(range.from, "d MMM", { locale: ru })} – ${format(range.to, "d MMM yyyy", { locale: ru })}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-12 gap-2 rounded-2xl border-border/60 bg-card/40">
          <CalendarIcon className="h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex border-b border-border/40 p-2">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant="ghost"
              size="sm"
              onClick={() => {
                const to = new Date();
                const from = new Date();
                from.setDate(from.getDate() - (p.days - 1));
                onChange({ from, to });
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={tempRange}
          onSelect={(r) => { setTempRange(r); apply(r); }}
          numberOfMonths={2}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}