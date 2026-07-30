import { useMemo, useState } from "react";
import { TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import {
  buildLeadDynamics,
  leadPeriodPresetLabel,
  type LeadPeriodPreset,
} from "@/lib/crmLeadDynamics";

const PRESETS: LeadPeriodPreset[] = ["today", "yesterday", "week", "last7", "month"];

interface Props {
  leads: Lead[];
  className?: string;
}

export function CrmLeadDynamics({ leads, className }: Props) {
  const [preset, setPreset] = useState<LeadPeriodPreset>("today");
  const [focusYmd, setFocusYmd] = useState<string | null>(null);

  const dynamics = useMemo(
    () => buildLeadDynamics(leads, preset, { focusYmd }),
    [leads, preset, focusYmd],
  );

  const max = Math.max(1, ...dynamics.days.map((d) => d.count));
  const multiDay = dynamics.days.length > 1;

  const deltaText = (() => {
    if (dynamics.delta === 0) return "как в прошлом периоде";
    const sign = dynamics.delta > 0 ? "+" : "";
    if (focusYmd || preset === "today" || preset === "yesterday") {
      return `${sign}${dynamics.delta} к предыдущему дню`;
    }
    return `${sign}${dynamics.delta} к прошлому периоду`;
  })();

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/60 p-3 sm:p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            Динамика лидов
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums leading-none sm:text-4xl">
              {dynamics.total}
            </span>
            <span className="text-sm text-muted-foreground">
              {dynamics.total === 1 ? "лид" : dynamics.total >= 2 && dynamics.total <= 4 ? "лида" : "лидов"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{dynamics.rangeLabel}</span>
            <span className="text-border">·</span>
            <span
              className={cn(
                "tabular-nums",
                dynamics.delta > 0 && "text-success",
                dynamics.delta < 0 && "text-destructive",
              )}
            >
              {deltaText}
            </span>
            {focusYmd && (
              <button
                type="button"
                onClick={() => setFocusYmd(null)}
                className="text-primary hover:underline"
              >
                весь период
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const active = preset === p && !focusYmd;
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPreset(p);
                  setFocusYmd(null);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/60 bg-background/40 text-muted-foreground hover:text-foreground",
                )}
              >
                {leadPeriodPresetLabel(p)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Daily bars */}
      <div className="mt-3 flex items-end gap-1 sm:gap-1.5" style={{ minHeight: multiDay ? 72 : 48 }}>
        {dynamics.days.map((day) => {
          const h = Math.max(day.count > 0 ? 12 : 4, Math.round((day.count / max) * (multiDay ? 64 : 40)));
          const selected = focusYmd === day.ymd || (!focusYmd && dynamics.days.length === 1);
          return (
            <button
              key={day.ymd}
              type="button"
              title={`${day.label}: ${day.count}`}
              onClick={() => {
                if (dynamics.days.length === 1) return;
                setFocusYmd((prev) => (prev === day.ymd ? null : day.ymd));
              }}
              className={cn(
                "group flex min-w-0 flex-1 flex-col items-center gap-1",
                dynamics.days.length === 1 && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-semibold tabular-nums",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {day.count}
              </span>
              <span
                className={cn(
                  "w-full max-w-[36px] rounded-t-md transition-colors",
                  selected
                    ? "bg-primary"
                    : "bg-primary/35 group-hover:bg-primary/55",
                )}
                style={{ height: h }}
              />
              <span
                className={cn(
                  "text-[10px] capitalize",
                  selected ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {multiDay ? day.shortLabel : day.label}
              </span>
            </button>
          );
        })}
      </div>

      {multiDay && (
        <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Users className="h-3 w-3" />
          Нажмите на день, чтобы увидеть точное число за эту дату
        </p>
      )}
    </div>
  );
}
