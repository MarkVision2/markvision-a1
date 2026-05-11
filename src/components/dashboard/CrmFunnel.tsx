import { Phone, CalendarCheck, MapPin, CreditCard, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  data: { total: number; reached: number; scheduled: number; visited: number; paid: number };
}

export function CrmFunnel({ data }: Props) {
  const steps = [
    { id: "total", label: "Заявки всего", icon: Users, value: data.total, base: data.total },
    { id: "reached", label: "Дозвон", icon: Phone, value: data.reached, base: data.total },
    { id: "scheduled", label: "Записались", icon: CalendarCheck, value: data.scheduled, base: data.total },
    { id: "visited", label: "Пришли", icon: MapPin, value: data.visited, base: data.total },
    { id: "paid", label: "Оплатили", icon: CreditCard, value: data.paid, base: data.total },
  ];

  if (data.total === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        Пока нет заявок в CRM за выбранный период.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="space-y-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const pct = s.base > 0 ? (s.value / s.base) * 100 : 0;
          return (
            <div key={s.id} className="grid grid-cols-[120px_1fr_80px] items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </div>
              <div className="relative h-9 overflow-hidden rounded-lg border border-border/40 bg-secondary/20">
                <div
                  className={cn(
                    "h-full bg-gradient-to-r",
                    i === 0 && "from-primary/40 to-primary/20",
                    i === 1 && "from-primary/35 to-primary/15",
                    i === 2 && "from-warning/35 to-warning/15",
                    i === 3 && "from-success/35 to-success/15",
                    i === 4 && "from-success/45 to-success/25",
                  )}
                  style={{ width: `${Math.max(pct, s.value > 0 ? 4 : 0)}%` }}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold tabular-nums">
                  {s.value.toLocaleString("ru-RU")}
                </span>
              </div>
              <div className="text-right text-sm font-bold tabular-nums">
                {pct.toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
