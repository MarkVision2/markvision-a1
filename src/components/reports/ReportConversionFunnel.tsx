import {
  Eye, MousePointerClick, ShoppingCart, Target, Users,
} from "lucide-react";
import type { ReportTotals } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";
import { fmtNum, fmtPct } from "./reportFormat";

interface Stage {
  id: string;
  label: string;
  value: number;
  icon: React.ElementType;
  gradient: string;
  glow: string;
}

interface Props {
  totals: ReportTotals;
}

function stageWidthPct(value: number, max: number): number {
  if (value <= 0) return 6;
  return Math.max((value / max) * 100, 10);
}

function trapezoidClip(topPct: number, bottomPct: number): string {
  const tl = (100 - topPct) / 2;
  const tr = tl + topPct;
  const bl = (100 - bottomPct) / 2;
  const br = bl + bottomPct;
  return `polygon(${tl}% 0, ${tr}% 0, ${br}% 100%, ${bl}% 100%)`;
}

export function ReportConversionFunnel({ totals }: Props) {
  const stages: Stage[] = [
    {
      id: "imp",
      label: "Показы",
      value: totals.impressions,
      icon: Eye,
      gradient: "from-emerald-500/90 via-emerald-600/75 to-emerald-700/60",
      glow: "shadow-[0_0_28px_-6px_hsl(152_60%_45%/0.55)]",
    },
    {
      id: "clk",
      label: "Клики",
      value: totals.clicks,
      icon: MousePointerClick,
      gradient: "from-teal-500/85 via-teal-600/70 to-teal-700/55",
      glow: "shadow-[0_0_24px_-6px_hsl(174_55%_42%/0.45)]",
    },
    {
      id: "led",
      label: "Заявки",
      value: totals.totalLeads,
      icon: Users,
      gradient: "from-cyan-500/80 via-cyan-600/65 to-cyan-700/50",
      glow: "shadow-[0_0_22px_-6px_hsl(189_55%_42%/0.4)]",
    },
    {
      id: "vis",
      label: "Диагностики",
      value: totals.visits,
      icon: Target,
      gradient: "from-sky-500/75 via-sky-600/60 to-sky-700/45",
      glow: "shadow-[0_0_20px_-6px_hsl(199_55%_45%/0.35)]",
    },
    {
      id: "sal",
      label: "Продажи",
      value: totals.sales,
      icon: ShoppingCart,
      gradient: "from-amber-500/70 via-amber-600/55 to-amber-700/40",
      glow: "shadow-[0_0_18px_-6px_hsl(38_80%_50%/0.35)]",
    },
  ];

  const max = Math.max(...stages.map((s) => s.value), 1);
  const widths = stages.map((s) => stageWidthPct(s.value, max));

  const conversions = stages.map((s, i) =>
    i === 0 || stages[i - 1].value === 0 ? null : (s.value / stages[i - 1].value) * 100,
  );

  let worstIdx = -1;
  let worstVal = Infinity;
  conversions.forEach((c, i) => {
    if (c !== null && c < worstVal && stages[i - 1].value > 0) {
      worstVal = c;
      worstIdx = i;
    }
  });

  const overallCr =
    totals.impressions > 0 ? (totals.sales / totals.impressions) * 100 : null;
  const leadToSale =
    totals.totalLeads > 0 ? (totals.sales / totals.totalLeads) * 100 : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/30">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Путь клиента
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {overallCr !== null && (
            <span className="rounded-full border border-border/50 bg-secondary/40 px-3 py-1 text-[11px] font-semibold tabular-nums text-foreground/90">
              Показ → продажа: <span className="text-success">{fmtPct(overallCr)}</span>
            </span>
          )}
          {leadToSale !== null && (
            <span className="rounded-full border border-border/50 bg-secondary/40 px-3 py-1 text-[11px] font-semibold tabular-nums text-foreground/90">
              Заявка → продажа: <span className="text-primary">{fmtPct(leadToSale)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_240px] lg:items-start">
        <div className="mx-auto w-full max-w-xl">
          {stages.map((stage, i) => {
            const topW = widths[i];
            const bottomW = i < stages.length - 1 ? widths[i + 1] : Math.max(widths[i] * 0.65, 6);
            const conv = conversions[i];
            const isWorst = i === worstIdx;
            const Icon = stage.icon;
            const isEmpty = stage.value === 0;

            return (
              <div key={stage.id}>
                <div
                  className={cn(
                    "relative h-[58px] w-full transition-transform",
                    stage.glow,
                    isEmpty && "opacity-55",
                  )}
                  style={{ clipPath: trapezoidClip(topW, bottomW) }}
                >
                  <div
                    className={cn(
                      "absolute inset-0 bg-gradient-to-b",
                      stage.gradient,
                      isEmpty && "from-secondary/50 via-secondary/35 to-secondary/25",
                    )}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
                  <div className="relative flex h-full items-center justify-between px-5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-black/20 text-white/90">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider text-white/90">
                        {stage.label}
                      </span>
                    </div>
                    <span className="text-lg font-bold tabular-nums text-white drop-shadow-sm">
                      {fmtNum(stage.value)}
                    </span>
                  </div>
                </div>

                {conv !== null && (
                  <div className="relative flex justify-center py-2">
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold tabular-nums",
                        isWorst
                          ? "border-destructive/50 bg-destructive/10 text-destructive"
                          : "border-success/35 bg-success/10 text-success",
                      )}
                    >
                      <span className="text-[10px] opacity-70">↓</span>
                      <span>{fmtPct(conv)}</span>
                      <span className="font-medium opacity-80">
                        {stages[i - 1].label} → {stage.label}
                      </span>
                      {isWorst && (
                        <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                          узкое место
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Детализация этапов
          </div>
          {stages.map((stage, i) => {
            const conv = conversions[i];
            const loss = conv !== null ? 100 - conv : null;
            const share = (stage.value / max) * 100;
            const Icon = stage.icon;

            return (
              <div
                key={`detail-${stage.id}`}
                className={cn(
                  "rounded-xl border px-3 py-2.5",
                  i === worstIdx
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/40 bg-secondary/15",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold">{stage.label}</span>
                  </div>
                  <span className="text-sm font-bold tabular-nums">{fmtNum(stage.value)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/50">
                  <div
                    className={cn(
                      "h-full rounded-full bg-gradient-to-r",
                      stage.gradient,
                      stage.value === 0 && "from-secondary/40 to-secondary/20",
                    )}
                    style={{ width: `${Math.max(share, stage.value > 0 ? 4 : 0)}%` }}
                  />
                </div>
                {conv !== null && loss !== null && (
                  <div className="mt-2 flex items-center justify-between text-[10px] tabular-nums">
                    <span className="font-semibold text-success">Конверсия {fmtPct(conv)}</span>
                    <span className="text-destructive/90">Потери −{fmtPct(loss)}</span>
                  </div>
                )}
                {i === 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Старт воронки — 100% аудитории
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
