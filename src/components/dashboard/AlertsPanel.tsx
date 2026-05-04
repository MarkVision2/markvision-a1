import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashAlert } from "@/lib/dashboardAlerts";

const STYLE = {
  critical: {
    border: "border-destructive/40",
    bg: "bg-destructive/10",
    icon: "text-destructive",
    Icon: AlertTriangle,
    badge: "🔴",
  },
  warning: {
    border: "border-warning/40",
    bg: "bg-warning/10",
    icon: "text-warning",
    Icon: Info,
    badge: "🟡",
  },
  ok: {
    border: "border-success/40",
    bg: "bg-success/10",
    icon: "text-success",
    Icon: CheckCircle2,
    badge: "🟢",
  },
} as const;

interface Props {
  alerts: DashAlert[];
}

export function AlertsPanel({ alerts }: Props) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const visible = alerts
    .map((a, i) => ({ ...a, idx: i }))
    .filter((a) => !hidden.has(a.idx));

  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {visible.map((a) => {
        const s = STYLE[a.level];
        const Icon = s.Icon;
        return (
          <div
            key={a.idx}
            className={cn(
              "relative rounded-2xl border p-4 transition-colors",
              s.border,
              s.bg,
            )}
          >
            <button
              onClick={() => setHidden((prev) => new Set(prev).add(a.idx))}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              aria-label="Скрыть"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-start gap-3">
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", s.icon)} />
              <div className="min-w-0">
                <div className="text-sm font-bold">{a.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{a.message}</div>
                {a.recommendation && (
                  <div className="mt-2 text-xs">
                    <span className="font-semibold">Что делать:</span>{" "}
                    <span className="text-muted-foreground">{a.recommendation}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}