import { useState } from "react";
import { TrendingDown, Target, Sparkles, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StageMetrics, RejectStat } from "@/hooks/useCrmAnalytics";
import { monthKey, useRevenuePlan } from "@/hooks/useRevenuePlan";
import type { Lead } from "@/types/crm";
import { QualityBlock, QualityFunnel } from "@/components/crm/QualityBlock";

interface Props {
  stageMetrics: StageMetrics[];
  rejectStats: RejectStat[];
  forecast: number;
  actual: number;
  leads?: readonly Lead[];
}

export function AnalyticsView({ stageMetrics, rejectStats, forecast, actual, leads = [] }: Props) {
  const { store, setForMonth } = useRevenuePlan();
  const mk = monthKey();
  const plan = store[mk] ?? 0;
  const [draft, setDraft] = useState<string>(plan ? String(plan) : "");

  const totalLost = rejectStats.reduce((s, r) => s + r.lostRevenue, 0);
  const planPct = plan > 0 ? Math.min(100, (actual / plan) * 100) : 0;
  const forecastPct = plan > 0 ? Math.min(100, ((actual + forecast) / plan) * 100) : 0;

  const maxCount = Math.max(1, ...stageMetrics.map((s) => s.count));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {leads.length > 0 && (
        <>
          <div className="lg:col-span-2">
            <QualityBlock leads={leads} />
          </div>
          <div className="lg:col-span-2">
            <QualityFunnel leads={leads} />
          </div>
        </>
      )}

      {/* Funnel */}
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Воронка по этапам
        </div>
        <div className="mt-4 space-y-2">
          {stageMetrics.map((sm) => {
            const w = (sm.count / maxCount) * 100;
            return (
              <div key={sm.stage.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{sm.stage.title}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {sm.count} · {sm.potential.toLocaleString("ru-RU")} $
                    {sm.conversionFromPrev !== null && (
                      <span className="ml-2 text-primary">CR {sm.conversionFromPrev.toFixed(0)}%</span>
                    )}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary/60">
                  <div
                    className="h-full bg-gradient-primary"
                    style={{ width: `${w}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Plan / Fact / Forecast */}
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-primary" /> План / Факт / Прогноз ({mk})
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">План на месяц, $</label>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="например 5 000 000"
              className="w-44"
              inputMode="numeric"
            />
          </div>
          <Button variant="outline" onClick={() => setForMonth(mk, Number(draft) || 0)}>
            Сохранить
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-border/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Факт</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-success">{actual.toLocaleString("ru-RU")}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Прогноз</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{forecast.toLocaleString("ru-RU")}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">План</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-primary">{plan.toLocaleString("ru-RU")}</div>
          </div>
        </div>

        {plan > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Выполнение плана</span>
              <span className="tabular-nums">{planPct.toFixed(0)}% (+ прогноз {forecastPct.toFixed(0)}%)</span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-full bg-secondary/60">
              <div className="relative h-full">
                <div className="absolute inset-y-0 left-0 bg-primary/30" style={{ width: `${forecastPct}%` }} />
                <div className="absolute inset-y-0 left-0 bg-success" style={{ width: `${planPct}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Reject reasons */}
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingDown className="h-4 w-4 text-destructive" /> Причины отказов
          </div>
          <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Wallet className="h-3 w-3" /> Потеряно: <span className="font-bold text-destructive">{totalLost.toLocaleString("ru-RU")} $</span>
          </div>
        </div>
        {rejectStats.length === 0 ? (
          <div className="mt-6 text-center text-sm text-muted-foreground">
            Нет отказов с указанной причиной. Перетащите лид в колонку «Отказ» — система спросит причину.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {rejectStats.map((r) => (
              <div key={r.id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{r.emoji} {r.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {r.count} · {r.lostRevenue.toLocaleString("ru-RU")} $ ({r.share.toFixed(0)}%)
                  </span>
                </div>
                <div className={cn("mt-1 h-2 overflow-hidden rounded-full bg-secondary/60")}>
                  <div className="h-full bg-destructive/70" style={{ width: `${r.share}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}