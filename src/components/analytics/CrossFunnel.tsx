import type { ElementType } from "react";
import { ArrowDown, Coins, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Сквозная воронка денег — единая логическая цепочка от расхода до выручки.
 * Расход → Показы → Клики → Лиды → [Квалификация] → Продажи → Выручка.
 *
 * В отличие от воронки запуска (инфопродукт/вебинар), эта воронка универсальна
 * для любого проекта: показывает движение денег и трафика по этапам рекламы и CRM,
 * конверсию между шагами и экономику (CTR / CPL / цена записи / CPA / ROMI).
 */

export type FunnelTone = "spend" | "traffic" | "lead" | "qual" | "sale" | "revenue";

export interface CrossFunnelStage {
  key: string;
  label: string;
  hint?: string;
  /** Абсолютное значение: количество (kind=count) или деньги в ₸ (kind=money). */
  value: number;
  kind: "money" | "count";
  icon: ElementType;
  tone: FunnelTone;
  /** Экономика этапа — короткий чип справа (например «CPL 2 175 ₸»). */
  econ?: { label: string; value: string } | null;
}

interface CrossFunnelProps {
  stages: readonly CrossFunnelStage[];
  periodLabel?: string;
  loading?: boolean;
}

const fmtNumber = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtPct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

const TONE_BAR: Record<FunnelTone, string> = {
  spend: "from-slate-400/80 to-slate-500/40",
  traffic: "from-sky-400/85 to-sky-500/45",
  lead: "from-primary/85 to-primary/45",
  qual: "from-teal-400/85 to-teal-500/45",
  sale: "from-emerald-400/90 to-emerald-500/50",
  revenue: "from-success/90 to-success/55",
};

const TONE_ICON: Record<FunnelTone, string> = {
  spend: "bg-slate-400/15 text-slate-400",
  traffic: "bg-sky-400/15 text-sky-400",
  lead: "bg-primary/15 text-primary",
  qual: "bg-teal-400/15 text-teal-400",
  sale: "bg-emerald-400/15 text-emerald-400",
  revenue: "bg-success/15 text-success",
};

export function CrossFunnel({ stages, periodLabel, loading }: CrossFunnelProps) {
  const countStages = stages.filter((s) => s.kind === "count");
  const maxCount = Math.max(1, ...countStages.map((s) => s.value));

  const spend = stages.find((s) => s.key === "spend")?.value ?? 0;
  const revenue = stages.find((s) => s.key === "revenue")?.value ?? 0;
  const leadStage = stages.find((s) => s.key === "leads");
  const saleStage = stages.find((s) => s.key === "sales");
  const romi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
  const leadToSale =
    leadStage && leadStage.value > 0 && saleStage ? (saleStage.value / leadStage.value) * 100 : null;

  // Конверсии между соседними count-этапами + поиск узкого места.
  const convById = new Map<string, number>();
  let worstKey: string | null = null;
  let worstVal = Infinity;
  for (let i = 1; i < countStages.length; i++) {
    const prev = countStages[i - 1];
    const cur = countStages[i];
    if (prev.value <= 0) continue;
    const conv = (cur.value / prev.value) * 100;
    convById.set(cur.key, conv);
    if (conv < worstVal) {
      worstVal = conv;
      worstKey = cur.key;
    }
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-success/10 text-success">
              <Coins className="h-3.5 w-3.5" />
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider">Сквозная воронка</h2>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Путь денег: расход → трафик → лиды → продажи → выручка
            {periodLabel ? ` · ${periodLabel}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {leadToSale !== null && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-bold tabular-nums text-primary">
              Лид → продажа {fmtPct(leadToSale)}
            </span>
          )}
          {romi !== null && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold tabular-nums",
                romi >= 0
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              <TrendingUp className="h-3 w-3" />
              ROMI {romi >= 0 ? "+" : ""}
              {Math.round(romi)}%
            </span>
          )}
        </div>
      </div>

      <div className="mt-5">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isMoney = stage.kind === "money";
          const widthPct = isMoney
            ? 100
            : stage.value > 0
              ? Math.max((stage.value / maxCount) * 100, 6)
              : 0;
          const conv = convById.get(stage.key) ?? null;
          const isWorst = stage.key === worstKey && conv !== null;
          const prevStage = idx > 0 ? stages[idx - 1] : null;

          return (
            <div key={stage.key}>
              {/* Коннектор конверсии между count-этапами */}
              {conv !== null && prevStage && (
                <div className="flex items-center gap-2 py-1.5 pl-1 sm:pl-3">
                  <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                      isWorst
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border/50 bg-background/60 text-muted-foreground",
                    )}
                  >
                    {fmtPct(conv)}
                    <span className="font-medium opacity-75">
                      {prevStage.label} → {stage.label}
                    </span>
                    {isWorst && (
                      <span className="rounded bg-destructive/20 px-1 text-[9px] uppercase tracking-wide">
                        узкое место
                      </span>
                    )}
                  </span>
                </div>
              )}

              <div
                className={cn(
                  "flex items-center gap-3 rounded-xl px-2 py-2 transition-colors",
                  isMoney && "bg-background/40",
                )}
              >
                <div className="flex w-[6.5rem] shrink-0 items-center gap-2 sm:w-44">
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      TONE_ICON[stage.tone],
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">{stage.label}</div>
                    {stage.hint && (
                      <div className="truncate text-[10px] text-muted-foreground">{stage.hint}</div>
                    )}
                  </div>
                </div>

                <div
                  className={cn(
                    "relative h-9 flex-1 overflow-hidden rounded-lg",
                    isMoney ? "bg-transparent" : "bg-secondary/40",
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-lg bg-gradient-to-r transition-all",
                      TONE_BAR[stage.tone],
                      isMoney && "opacity-90",
                    )}
                    style={{ width: `${widthPct}%` }}
                  />
                  {stage.econ && (
                    <span className="absolute inset-y-0 right-2.5 flex items-center gap-1 text-[10px] font-medium text-foreground/70">
                      <span className="uppercase tracking-wide text-muted-foreground">
                        {stage.econ.label}
                      </span>
                      <span className="font-bold tabular-nums text-foreground/90">
                        {stage.econ.value}
                      </span>
                    </span>
                  )}
                </div>

                <div
                  className={cn(
                    "shrink-0 text-right tabular-nums",
                    isMoney ? "w-24 sm:w-32" : "w-16 sm:w-24",
                  )}
                >
                  <div
                    className={cn(
                      "font-bold leading-tight",
                      isMoney ? "text-base text-success" : "text-sm",
                    )}
                  >
                    {stage.value > 0 ? (isMoney ? fmtMoney(stage.value) : fmtNumber(stage.value)) : "—"}
                  </div>
                  {stage.kind === "count" && idx > 0 && countStages[0] && countStages[0].value > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {fmtPct((stage.value / countStages[0].value) * 100)} от показов
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Обновляем данные…
        </div>
      )}
    </div>
  );
}
