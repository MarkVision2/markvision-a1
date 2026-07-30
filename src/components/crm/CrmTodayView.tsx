import { useMemo, useState } from "react";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import {
  buildLeadDynamics,
  leadPeriodPresetLabel,
  type LeadPeriodPreset,
} from "@/lib/crmLeadDynamics";
import { ymdAlmatyFromIso } from "@/lib/metaSync";

const PRESETS: LeadPeriodPreset[] = ["today", "yesterday", "week", "last7", "month"];

interface Props {
  leads: Lead[];
  onOpenLead: (lead: Lead) => void;
  onOpenFunnel: () => void;
  className?: string;
}

function pluralLeads(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "лид";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "лида";
  return "лидов";
}

function stageTitle(stageId: string): string {
  const map: Record<string, string> = {
    new: "Новый",
    bot_activated: "Бот",
    joined_group: "В группе",
    confirmed: "Подтвердил",
    visit: "Визит",
    deposit: "Бронь",
    scheduled: "Созвон",
    call_done: "Созвон ок",
    invoice: "Счёт",
    paid: "Оплата",
    rejected: "Отказ",
  };
  return map[stageId] ?? stageId;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}

export function CrmTodayView({ leads, onOpenLead, onOpenFunnel, className }: Props) {
  const [preset, setPreset] = useState<LeadPeriodPreset>("week");
  const [focusYmd, setFocusYmd] = useState<string | null>(null);

  const dynamics = useMemo(
    () => buildLeadDynamics(leads, preset, { focusYmd }),
    [leads, preset, focusYmd],
  );

  const snapshots = useMemo(() => {
    const today = buildLeadDynamics(leads, "today");
    const yesterday = buildLeadDynamics(leads, "yesterday");
    const week = buildLeadDynamics(leads, "week");
    return [
      { preset: "today" as const, total: today.total, label: "Сегодня" },
      { preset: "yesterday" as const, total: yesterday.total, label: "Вчера" },
      { preset: "week" as const, total: week.total, label: "Неделя" },
    ];
  }, [leads]);

  const max = Math.max(1, ...dynamics.days.map((d) => d.count));
  const multiDay = dynamics.days.length > 1;

  const periodLeads = useMemo(() => {
    return leads
      .filter((l) => {
        const day = ymdAlmatyFromIso(l.createdAt);
        if (!day) return false;
        if (focusYmd) return day === focusYmd;
        return day >= dynamics.fromYmd && day <= dynamics.toYmd;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [leads, dynamics.fromYmd, dynamics.toYmd, focusYmd]);

  const DeltaIcon = dynamics.delta >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className={cn("space-y-5", className)}>
      {/* Hero dynamics */}
      <section className="relative overflow-hidden rounded-3xl border border-border/50 bg-gradient-to-br from-success/[0.08] via-card/80 to-background p-4 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-success/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 left-10 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
        />

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Лиды
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <span className="text-5xl font-bold tracking-tight tabular-nums sm:text-6xl">
                  {dynamics.total}
                </span>
                <div className="mb-1.5 space-y-0.5">
                  <div className="text-sm font-medium text-muted-foreground">
                    {pluralLeads(dynamics.total)} · {dynamics.rangeLabel}
                  </div>
                  <div
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
                      dynamics.delta > 0 && "text-success",
                      dynamics.delta < 0 && "text-destructive",
                      dynamics.delta === 0 && "text-muted-foreground",
                    )}
                  >
                    <DeltaIcon className="h-3.5 w-3.5" />
                    {dynamics.delta === 0
                      ? "без изменений"
                      : `${dynamics.delta > 0 ? "+" : ""}${dynamics.delta} к прошлому`}
                  </div>
                </div>
              </div>
            </div>

            <div className="inline-flex flex-wrap rounded-2xl border border-border/60 bg-background/50 p-1 backdrop-blur">
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
                      "rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                      active
                        ? "bg-success text-success-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {leadPeriodPresetLabel(p)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Snapshot cards */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {snapshots.map((s) => {
              const active = preset === s.preset && !focusYmd;
              return (
                <button
                  key={s.preset}
                  type="button"
                  onClick={() => {
                    setPreset(s.preset);
                    setFocusYmd(null);
                  }}
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-left transition-all sm:px-4",
                    active
                      ? "border-success/40 bg-success/15 shadow-[0_0_0_1px_hsla(var(--success)/0.2)]"
                      : "border-border/50 bg-background/40 hover:border-border hover:bg-background/70",
                  )}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">{s.total}</div>
                </button>
              );
            })}
          </div>

          {/* Chart */}
          <div
            className="flex items-end gap-1.5 rounded-2xl border border-border/40 bg-background/35 px-2 pb-2 pt-4 sm:gap-2 sm:px-3"
            style={{ minHeight: multiDay ? 140 : 100 }}
          >
            {dynamics.days.map((day) => {
              const chartH = multiDay ? 96 : 56;
              const h = Math.max(
                day.count > 0 ? 14 : 6,
                Math.round((day.count / max) * chartH),
              );
              const selected =
                focusYmd === day.ymd || (!focusYmd && dynamics.days.length === 1);
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
                    "group flex min-w-0 flex-1 flex-col items-center gap-1.5",
                    dynamics.days.length === 1 && "cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "text-[11px] font-bold tabular-nums",
                      selected ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {day.count}
                  </span>
                  <span
                    className={cn(
                      "w-full max-w-[44px] rounded-t-lg transition-all",
                      selected
                        ? "bg-gradient-to-t from-success to-success/70"
                        : "bg-success/30 group-hover:bg-success/50",
                    )}
                    style={{ height: h }}
                  />
                  <span
                    className={cn(
                      "text-[10px]",
                      selected ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {multiDay ? day.shortLabel : day.label}
                  </span>
                </button>
              );
            })}
          </div>

          {focusYmd && (
            <button
              type="button"
              onClick={() => setFocusYmd(null)}
              className="self-start text-xs font-medium text-success hover:underline"
            >
              Показать весь период
            </button>
          )}
        </div>
      </section>

      {/* Clean period lead list */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Лиды за период</h3>
            <p className="text-xs text-muted-foreground">
              {periodLeads.length} {pluralLeads(periodLeads.length)} · {dynamics.rangeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenFunnel}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/60 bg-card/60 px-3 text-xs font-semibold text-foreground hover:bg-secondary/60"
          >
            Воронка
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {periodLeads.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed border-border/50 text-sm text-muted-foreground">
            За этот период лидов пока нет
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border/50 bg-card/40 divide-y divide-border/40">
            {periodLeads.slice(0, 40).map((lead) => (
              <li key={lead.id}>
                <button
                  type="button"
                  onClick={() => onOpenLead(lead)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{lead.name || "Без имени"}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span>{stageTitle(lead.stageId)}</span>
                      {lead.source ? (
                        <>
                          <span>·</span>
                          <span>{lead.source}</span>
                        </>
                      ) : null}
                      {lead.phone ? (
                        <>
                          <span>·</span>
                          <span className="tabular-nums">{lead.phone}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {timeAgo(lead.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
