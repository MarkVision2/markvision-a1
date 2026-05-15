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
  if (yesterday === 0) return today > 0 ? `+${today} к вчера` : "вчера 0";
  const d = today - yesterday;
  return `${d >= 0 ? "+" : ""}${d} к вчера (${yesterday})`;
}

export function CrmKpiBar({ kpi }: Props) {
  const sla = slaTone(kpi.avgResponseMin);
  const slaColor = sla === "good" ? "text-success" : sla === "warn" ? "text-warning" : "text-destructive";

  const items = [
    {
      icon: Flame,
      label: "Новые сегодня",
      value: String(kpi.newToday),
      sub: deltaLabel(kpi.newToday, kpi.newYesterday),
      tone: "primary" as const,
    },
    {
      icon: TimerReset,
      label: "Ответ клиенту",
      value: kpi.avgResponseMin > 0 ? `${kpi.avgResponseMin} мин` : "—",
      sub: sla === "good" ? "Вовремя" : sla === "warn" ? "Лучше ускорить" : "Слишком долго",
      tone: sla,
      valueClass: slaColor,
    },
    {
      icon: Phone,
      label: "Дозвон",
      value: `${kpi.reachedPct.toFixed(0)}%`,
      sub: "заявок в работе",
      tone: "primary" as const,
    },
    {
      icon: Calendar,
      label: "Запись",
      value: `${kpi.scheduledPct.toFixed(0)}%`,
      sub: "от всех заявок",
      tone: "primary" as const,
    },
    {
      icon: CreditCard,
      label: "Оплата",
      value: `${kpi.paidPct.toFixed(0)}%`,
      sub: "из заявок в оплату",
      tone: "success" as const,
    },
    {
      icon: XCircle,
      label: "Потери",
      value: `${kpi.rejectedPct.toFixed(0)}%`,
      sub: kpi.topRejectReason ? `Топ: ${kpi.topRejectReason.label}` : "Причины не заполнены",
      tone: "bad" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div key={it.label} className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-xl ring-1",
                  it.tone === "good" && "bg-success/15 text-success ring-success/30",
                  it.tone === "warn" && "bg-warning/15 text-warning ring-warning/30",
                  it.tone === "bad" && "bg-destructive/15 text-destructive ring-destructive/30",
                  it.tone === "success" && "bg-success/15 text-success ring-success/30",
                  it.tone === "primary" && "bg-primary/15 text-primary ring-primary/30",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                {it.label}
              </span>
            </div>
            <div className={cn("mt-3 text-2xl font-bold tabular-nums", it.valueClass)}>
              {it.value}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{it.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
