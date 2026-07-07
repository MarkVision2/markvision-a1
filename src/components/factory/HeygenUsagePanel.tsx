import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2, Wallet } from "lucide-react";
import { fetchQuota } from "@/hooks/useHeygen";
import { fetchUsage, RATE_USD_PER_MIN } from "@/lib/heygenUsage";

const MODE_LABEL: Record<string, string> = {
  agent: "Быстро",
  avatar: "Аватар",
  template: "Шаблон",
  clips: "Клипы",
};

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

// Панель «Баланс и расходы»: остаток квоты HeyGen + история и стоимость роликов проекта.
export function HeygenUsagePanel({ projectId }: { projectId: string }) {
  const quotaQ = useQuery({ queryKey: ["heygen-quota"], queryFn: fetchQuota, staleTime: 60_000, retry: 1 });
  const usageQ = useQuery({
    queryKey: ["heygen-usage", projectId],
    queryFn: () => fetchUsage(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const usage = usageQ.data ?? [];
  const total = usage.reduce((s, u) => s + (u.cost_usd ?? 0), 0);
  const remaining = quotaQ.data?.remaining_quota;

  return (
    <section className="mt-8 rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Wallet className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Баланс и расходы</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border/50 bg-background/40 p-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Coins className="h-3.5 w-3.5" /> Остаток HeyGen
          </div>
          {quotaQ.isLoading ? (
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> загрузка…
            </div>
          ) : quotaQ.error ? (
            <div className="mt-1 text-sm text-warning">нет доступа к квоте</div>
          ) : (
            <div className="mt-1">
              <div className="text-lg font-bold tabular-nums">{remaining ?? "—"} <span className="text-xs font-normal text-muted-foreground">кредитов</span></div>
              <div className="text-[11px] text-muted-foreground">≈ мин. стандартного видео; Video Agent ~2 кредита/мин</div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-background/40 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Потрачено (проект)</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{fmtUsd(total)}</div>
          <div className="text-[11px] text-muted-foreground">за последние {usage.length} роликов</div>
        </div>
      </div>

      {usage.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">История</div>
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {usage.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-sm">
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">{MODE_LABEL[u.mode] ?? u.mode}</span>
                <span className="text-xs text-muted-foreground">{u.source === "telegram" ? "Telegram" : "Сайт"}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {u.duration_sec ? `${Math.round(u.duration_sec)}с` : "—"}
                </span>
                <span className="w-14 text-right font-medium tabular-nums">
                  {u.cost_usd != null ? fmtUsd(u.cost_usd) : "≈ —"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Стоимость — оценка по тарифам pay-as-you-go: Video Agent ${RATE_USD_PER_MIN.agent}/мин, аватар ${RATE_USD_PER_MIN.avatar}/мин.
        Точную квоту показывает HeyGen.
      </p>
    </section>
  );
}
