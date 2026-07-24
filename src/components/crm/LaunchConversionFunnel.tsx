import { HandCoins, MessageCircle, ShoppingCart, UserCheck, Users, Video } from "lucide-react";
import {
  LAUNCH_CONVERSION_STEPS,
  buildLaunchConversionFunnel,
  buildLaunchKpis,
  type LaunchStageRow,
} from "@/lib/launchFunnel";
import { fmtKzt, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeadLite } from "@/hooks/useLeadsLite";
import type { Lead } from "@/types/crm";

type FunnelLead = Pick<
  LeadLite,
  | "stageKey"
  | "stageRole"
  | "paid"
  | "paidAt"
  | "depositAmount"
  | "webinarStatus"
  | "amount"
  | "temperature"
>;

function toLite(lead: Lead | FunnelLead): FunnelLead {
  const any = lead as Partial<Lead> & Partial<FunnelLead>;
  return {
    stageKey: any.stageKey ?? any.stageId ?? "new",
    stageRole: any.stageRole ?? null,
    paid: !!any.paid,
    paidAt: any.paidAt ?? null,
    depositAmount: any.depositAmount ?? null,
    webinarStatus: any.webinarStatus ?? null,
    amount: any.amount ?? 0,
    temperature: any.temperature ?? null,
  };
}

const STEP_META: Record<
  string,
  { icon: typeof Users; bar: string }
> = {
  new: { icon: Users, bar: "from-slate-400/85 to-slate-600/50" },
  bot_activated: { icon: MessageCircle, bar: "from-sky-400/90 to-sky-600/55" },
  joined_group: { icon: Users, bar: "from-cyan-400/90 to-cyan-600/55" },
  confirmed: { icon: UserCheck, bar: "from-teal-400/90 to-teal-600/55" },
  attended: { icon: Video, bar: "from-emerald-400/90 to-emerald-600/55" },
  deposit: { icon: HandCoins, bar: "from-amber-400/90 to-amber-600/55" },
  paid: { icon: ShoppingCart, bar: "from-success/90 to-success/55" },
};

interface Props {
  leads: readonly (Lead | FunnelLead)[];
  /** Optional period label, e.g. «Июль 2026» */
  periodLabel?: string;
  className?: string;
  /** Show compact KPI strip above bars */
  showKpis?: boolean;
}

export function LaunchConversionFunnel({
  leads,
  periodLabel,
  className,
  showKpis = true,
}: Props) {
  const lite = leads.map(toLite);
  const rows: LaunchStageRow[] = buildLaunchConversionFunnel(lite);
  const kpis = buildLaunchKpis(lite);
  const max = Math.max(1, ...rows.map((r) => r.leads));

  let worstIdx = -1;
  let worstVal = Infinity;
  rows.forEach((r, i) => {
    if (i === 0 || r.conversionFromPrev == null) return;
    if (r.conversionFromPrev < worstVal && rows[i - 1].leads > 0) {
      worstVal = r.conversionFromPrev;
      worstIdx = i;
    }
  });

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border/60 bg-card/40", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Воронка запуска
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Лид → бот → группа → подтверждение → вебинар → предоплата → оплата
            {periodLabel ? ` · ${periodLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {kpis.e2eConversion != null && (
            <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-success">
              Лид → оплата {kpis.e2eConversion.toFixed(1)}%
            </span>
          )}
          {kpis.deposits > 0 && (
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums">
              Бронь {fmtNum(kpis.deposits)} · {fmtKzt(kpis.depositRevenue)}
            </span>
          )}
          {kpis.revenue > 0 && (
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums">
              Выручка {fmtKzt(kpis.revenue)}
            </span>
          )}
        </div>
      </div>

      {showKpis && (
        <div className="grid grid-cols-2 gap-2 border-b border-border/40 p-3 sm:grid-cols-4 lg:grid-cols-7">
          {rows.map((r) => (
            <div key={`kpi-${r.role}`} className="rounded-xl border border-border/50 bg-background/40 px-2.5 py-2">
              <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums leading-none">{fmtNum(r.leads)}</div>
              <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                {r.conversionFromTop != null ? `${r.conversionFromTop.toFixed(0)}% от лидов` : "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 p-4">
        {rows.map((row, i) => {
          const meta = STEP_META[row.role] ?? STEP_META.new;
          const Icon = meta.icon;
          const hint = LAUNCH_CONVERSION_STEPS[i]?.hint;
          const widthPct = row.leads > 0 ? Math.max((row.leads / max) * 100, 8) : 0;
          const isWorst = i === worstIdx && rows[i - 1].leads > 0;
          const isPaid = row.role === "paid";

          return (
            <div key={row.role}>
              {row.conversionFromPrev != null && (
                <div className="flex items-center gap-2 py-1.5 pl-[7.5rem] sm:pl-44">
                  <div className="h-3 w-px bg-border" />
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                      isWorst
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border/50 bg-background/60 text-muted-foreground",
                    )}
                  >
                    ↓ {row.conversionFromPrev.toFixed(0)}%
                    <span className="font-medium opacity-80">
                      {rows[i - 1].label} → {row.label}
                    </span>
                    {isWorst ? (
                      <span className="rounded bg-destructive/20 px-1 text-[9px] uppercase">узкое место</span>
                    ) : null}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex w-[7rem] shrink-0 items-center gap-1.5 sm:w-40">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", isPaid ? "text-success" : "text-muted-foreground")} />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{row.label}</div>
                    {hint ? <div className="truncate text-[10px] text-muted-foreground">{hint}</div> : null}
                  </div>
                </div>
                <div className="relative min-h-8 flex-1 overflow-hidden rounded-lg bg-secondary/50">
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r transition-all",
                      meta.bar,
                    )}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 text-right text-sm font-bold tabular-nums sm:w-20">
                  {fmtNum(row.leads)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
