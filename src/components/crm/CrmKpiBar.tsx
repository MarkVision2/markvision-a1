import {
  Calendar, CreditCard, Flame, Phone, TimerReset, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CrmKpi } from "@/hooks/useCrmAnalytics";
import { slaTone } from "@/hooks/useCrmAnalytics";

interface Props {
  kpi: CrmKpi;
}

function deltaLabel(today: number, yesterday: number) {
  if (yesterday === 0) return today > 0 ? `+${today}` : "0";
  const d = today - yesterday;
  return `${d >= 0 ? "+" : ""}${d}`;
}

export function CrmKpiBar({ kpi }: Props) {
  const sla = slaTone(kpi.avgResponseMin);
  const slaColor = sla === "good" ? "text-success" : sla === "warn" ? "text-warning" : "text-destructive";

  const items = [
    {
      icon: Flame,
      label: "Новые сегодня",
      value: String(kpi.newToday),
      sub: `${deltaLabel(kpi.newToday, kpi.newYesterday)} к вчера`,
      tone: "primary" as const,
    },
    {
      icon: TimerReset,
      label: "Время ответа",
      value: kpi.avgResponseMin > 0 ? `${kpi.avgResponseMin} мин` : "—",
      sub: sla === "good" ? "В норме" : sla === "warn" ? "Подтянуть" : "Критично",
      tone: sla,
      valueClass: slaColor,
    },
    {
      icon: Phone,
      label: "Дозвон",
      value: `${kpi.reachedPct.toFixed(0)}%`,
      sub: "в работе",
      tone: "primary" as const,
    },
    {
      icon: Calendar,
      label: "Запись",
      value: `${kpi.scheduledPct.toFixed(0)}%`,
      sub: "от лидов",
      tone: "primary" as const,
    },
    {
      icon: CreditCard,
      label: "Оплата",
      value: `${kpi.paidPct.toFixed(0)}%`,
      sub: "в продажу",
      tone: "success" as const,
    },
    {
      icon: XCircle,
      label: "Потери",
      value: `${kpi.rejectedPct.toFixed(0)}%`,
      sub: kpi.topRejectReason ? kpi.topRejectReason.label : "—",
      tone: "bad" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.label}
            className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 px-3 py-2"
          >
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1",
                it.tone === "good" && "bg-success/15 text-success ring-success/30",
                it.tone === "warn" && "bg-warning/15 text-warning ring-warning/30",
                it.tone === "bad" && "bg-destructive/15 text-destructive ring-destructive/30",
                it.tone === "success" && "bg-success/15 text-success ring-success/30",
                it.tone === "primary" && "bg-primary/15 text-primary ring-primary/30",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {it.label}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={cn("text-base font-bold tabular-nums leading-none", it.valueClass)}>
                  {it.value}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">{it.sub}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
