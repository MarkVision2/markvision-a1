import { useMemo, useState } from "react";
import { ArrowRight, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import {
  buildLeadChannelBreakdown,
  buildLeadDynamics,
  leadPeriodPresetLabel,
  addDaysYmd,
  type LeadPeriodPreset,
} from "@/lib/crmLeadDynamics";
import { normalizeSource } from "@/lib/leadSource";
import { ymdAlmaty } from "@/lib/metaSync";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import {
  cplFromSpend,
  fmtCrmTenge,
  sumSpendInRange,
  useCrmAdSpend,
} from "@/hooks/useCrmAdSpend";
import { Link } from "react-router-dom";

const PRESETS: LeadPeriodPreset[] = ["today", "yesterday", "week", "last7", "month"];

interface Props {
  leads: Lead[];
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

export function CrmTodayView({ leads, onOpenFunnel, className }: Props) {
  const { activeId: projectId } = useProjectsStore();
  const { byDay: spendByDay, loading: spendLoading, lastDate: lastSpendDate } = useCrmAdSpend(projectId);

  const spendStale = useMemo(() => {
    // Баннер только если данные когда-то приходили, но отстали больше чем на сутки.
    // Если расходов нет вовсе (кабинет не подключён) — молчим, а не пугаем ошибкой.
    if (!lastSpendDate) return false;
    const today = ymdAlmaty();
    // Нормально, если последний CDI = вчера (cron тянет вчера ночью). Старше — проблема.
    return lastSpendDate < addDaysYmd(today, -1);
  }, [lastSpendDate]);


  const [preset, setPreset] = useState<LeadPeriodPreset>("today");
  const [focusYmd, setFocusYmd] = useState<string | null>(null);

  const dynamics = useMemo(
    () => buildLeadDynamics(leads, preset, { focusYmd }),
    [leads, preset, focusYmd],
  );

  const chart = useMemo(() => {
    if (preset === "today" || preset === "yesterday") {
      const spark = buildLeadDynamics(leads, "last7");
      const today = ymdAlmaty();
      const highlight =
        focusYmd
        ?? (preset === "today" ? today : spark.days[spark.days.length - 2]?.ymd ?? today);
      return { days: spark.days, highlight };
    }
    return { days: dynamics.days, highlight: focusYmd };
  }, [leads, preset, focusYmd, dynamics.days]);

  const periodSpend = useMemo(
    () => sumSpendInRange(spendByDay, dynamics.fromYmd, dynamics.toYmd, focusYmd),
    [spendByDay, dynamics.fromYmd, dynamics.toYmd, focusYmd],
  );
  const periodCpl = cplFromSpend(periodSpend, dynamics.total);

  const snapshots = useMemo(() => {
    const items: Array<{
      preset: LeadPeriodPreset;
      total: number;
      spend: number;
      cpl: number;
      label: string;
    }> = [];
    for (const p of ["today", "yesterday", "week"] as LeadPeriodPreset[]) {
      const d = buildLeadDynamics(leads, p);
      const spend = sumSpendInRange(spendByDay, d.fromYmd, d.toYmd);
      items.push({
        preset: p,
        total: d.total,
        spend,
        cpl: cplFromSpend(spend, d.total),
        label: p === "today" ? "Сегодня" : p === "yesterday" ? "Вчера" : "Неделя",
      });
    }
    return items;
  }, [leads, spendByDay]);

  const channels = useMemo(
    () =>
      buildLeadChannelBreakdown(leads, dynamics.fromYmd, dynamics.toYmd, {
        focusYmd,
      }),
    [leads, dynamics.fromYmd, dynamics.toYmd, focusYmd],
  );

  const max = Math.max(1, ...chart.days.map((d) => d.count));
  const DeltaIcon = dynamics.delta >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className={cn(className)}>
      <section className="relative overflow-hidden rounded-3xl border border-border/50 bg-gradient-to-br from-success/[0.07] via-card/90 to-background p-4 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-success/10 blur-3xl"
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

              {/* Spend + CPL for selected period */}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-md">
                <div className="rounded-2xl border border-border/50 bg-background/50 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Wallet className="h-3 w-3" />
                    Расход
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums sm:text-xl">
                    {spendLoading && periodSpend <= 0 ? "…" : fmtCrmTenge(periodSpend)}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/50 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    CPL · стоимость лида
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-success sm:text-xl">
                    {spendLoading && periodCpl <= 0 ? "…" : fmtCrmTenge(periodCpl)}
                  </div>
                </div>
              </div>

              {spendStale && !spendLoading && (
                <div className="mt-3 max-w-xl rounded-2xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-foreground/90">
                  <b>Расходы Meta не обновлялись.</b> Последние данные:{" "}
                  {lastSpendDate ?? "—"}. Проверьте синхронизацию кабинета и права
                  токена (<code className="text-[10px]">ads_read</code>).{" "}
                  <Link to="/settings?tab=meta-tokens" className="font-semibold text-success underline-offset-2 hover:underline">
                    Настройки → Meta
                  </Link>

                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap rounded-2xl border border-border/60 bg-background/55 p-1 backdrop-blur">
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
              <button
                type="button"
                onClick={onOpenFunnel}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-success px-3.5 text-xs font-bold text-success-foreground hover:opacity-90"
              >
                Воронка
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Snapshots with spend/CPL */}
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
                      ? "border-success/40 bg-success/15"
                      : "border-border/50 bg-background/40 hover:border-border hover:bg-background/70",
                  )}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {s.label}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">{s.total}</div>
                  <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                    <div className="flex justify-between gap-2">
                      <span>Расход</span>
                      <span className="font-semibold tabular-nums text-foreground/90">
                        {fmtCrmTenge(s.spend)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>CPL</span>
                      <span className="font-semibold tabular-nums text-success">
                        {fmtCrmTenge(s.cpl)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Chart + channels */}
          <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
            <div className="rounded-2xl border border-border/40 bg-background/40 p-3 sm:p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  По дням
                </h3>
                {(preset === "today" || preset === "yesterday") && (
                  <span className="text-[10px] text-muted-foreground">контекст · 7 дней</span>
                )}
              </div>
              <div className="flex items-end gap-1 sm:gap-1.5" style={{ minHeight: 132 }}>
                {chart.days.map((day) => {
                  const h = Math.max(
                    day.count > 0 ? 16 : 6,
                    Math.round((day.count / max) * 100),
                  );
                  const selected = chart.highlight === day.ymd;
                  const daySpend = spendByDay.get(day.ymd) ?? 0;
                  return (
                    <button
                      key={day.ymd}
                      type="button"
                      title={`${day.label}: ${day.count} лид. · ${fmtCrmTenge(daySpend)}`}
                      onClick={() => {
                        setFocusYmd((prev) => (prev === day.ymd ? null : day.ymd));
                      }}
                      className="group flex min-w-0 flex-1 flex-col items-center gap-1.5"
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
                          "w-full max-w-[40px] rounded-t-lg transition-all",
                          selected
                            ? "bg-gradient-to-t from-success to-success/65"
                            : "bg-success/25 group-hover:bg-success/45",
                        )}
                        style={{ height: h }}
                      />
                      <span
                        className={cn(
                          "text-[10px]",
                          selected ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {day.shortLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
              {focusYmd && (
                <button
                  type="button"
                  onClick={() => setFocusYmd(null)}
                  className="mt-3 text-xs font-medium text-success hover:underline"
                >
                  Сбросить день · весь период
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-border/40 bg-background/40 p-3 sm:p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Каналы
                </h3>
                <span className="text-[10px] text-muted-foreground">откуда пришли</span>
              </div>

              {channels.length === 0 ? (
                <div className="grid min-h-[132px] place-items-center text-sm text-muted-foreground">
                  Пока нет лидов за период
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {channels.map((ch) => {
                    const iconMeta = normalizeSource(
                      ch.key === "__other__" ? "" : (ch.raw || ch.key),
                    );
                    const ChannelIcon = iconMeta.Icon;
                    return (
                      <li key={ch.key} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary/60">
                            <ChannelIcon className={cn("h-3.5 w-3.5", iconMeta.cls)} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {ch.label}
                          </span>
                          <span className="text-sm font-bold tabular-nums">{ch.count}</span>
                          <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                            {Math.round(ch.share)}%
                          </span>
                        </div>
                        <div className="ml-9 h-1.5 overflow-hidden rounded-full bg-secondary/70">
                          <div
                            className="h-full rounded-full bg-success/80"
                            style={{ width: `${Math.max(4, ch.share)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
