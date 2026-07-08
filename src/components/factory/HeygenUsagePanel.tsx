import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2, Wallet } from "lucide-react";
import { fetchAccountStats, fetchRecentVideos } from "@/hooks/useHeygen";
import { fetchUsage, RATE_USD_PER_MIN } from "@/lib/heygenUsage";
import {
  formatHeygenBalance,
  formatHeygenUsd,
  sumEstimatedVideoSpend,
} from "@/lib/heygenAccount";

const MODE_LABEL: Record<string, string> = {
  agent: "Быстро",
  avatar: "Аватар",
  template: "Шаблон",
  clips: "Клипы",
  heygen: "HeyGen",
};

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

// Панель «Баланс и расходы»: остаток и расход из HeyGen API + локальная история проекта.
export function HeygenUsagePanel({ projectId }: { projectId: string }) {
  const accountQ = useQuery({
    queryKey: ["heygen-account"],
    queryFn: fetchAccountStats,
    staleTime: 60_000,
    retry: 1,
  });
  const videosQ = useQuery({
    queryKey: ["heygen-videos"],
    queryFn: () => fetchRecentVideos(50),
    staleTime: 60_000,
    retry: 1,
  });
  const usageQ = useQuery({
    queryKey: ["heygen-usage", projectId],
    queryFn: () => fetchUsage(projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const account = accountQ.data;
  const videos = videosQ.data ?? [];
  const usage = usageQ.data ?? [];

  const accountSpent = account?.spentUsd ?? (videos.length > 0 ? sumEstimatedVideoSpend(videos) : null);
  const projectSpent = usage.reduce((s, u) => s + (u.cost_usd ?? 0), 0);

  const history = useMemo(() => {
    const local = usage.map((u) => ({
      id: u.id,
      mode: u.mode,
      source: u.source,
      duration_sec: u.duration_sec,
      cost_usd: u.cost_usd,
      created_at: u.created_at,
      title: null as string | null,
    }));

    const remote = videos
      .filter((v) => v.status === "completed")
      .map((v) => ({
        id: `hg-${v.id}`,
        mode: "heygen",
        source: "heygen",
        duration_sec: v.durationSec,
        cost_usd: v.costUsd,
        created_at: v.createdAt ? new Date(v.createdAt * 1000).toISOString() : "",
        title: v.title,
      }));

    return [...local, ...remote]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, 20);
  }, [usage, videos]);

  const loading = accountQ.isLoading || videosQ.isLoading;

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
          {loading ? (
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> загрузка…
            </div>
          ) : accountQ.error ? (
            <div className="mt-1 text-sm text-warning">
              нет доступа к балансу
              <div className="mt-0.5 text-[11px] opacity-90">
                {(accountQ.error as Error).message || "проверь HEYGEN_API_KEY в Supabase Secrets"}
              </div>
            </div>
          ) : (
            <div className="mt-1">
              <div className="text-lg font-bold tabular-nums">
                {formatHeygenBalance(account?.remaining ?? null, account?.remainingIsUsd ?? false)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                из кабинета HeyGen · {account?.billingType ?? "аккаунт"}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-background/40 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Потрачено (аккаунт)</div>
          <div className="mt-1 text-lg font-bold tabular-nums">
            {formatHeygenUsd(accountSpent)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {account?.spentUsd != null
              ? "текущий период в HeyGen"
              : `оценка по ${videos.filter((v) => v.status === "completed").length} роликам`}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-border/40 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
        В MarkVision учтено: <span className="font-semibold text-foreground">{fmtUsd(projectSpent)}</span>
        {" · "}
        роликов в проекте: {usage.length}
      </div>

      {history.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">История</div>
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {history.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded-lg border border-border/40 px-2 py-1.5 text-sm">
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">
                  {MODE_LABEL[u.mode] ?? u.mode}
                </span>
                <span className="text-xs text-muted-foreground">
                  {u.source === "telegram" ? "Telegram" : u.source === "heygen" ? "HeyGen" : "Сайт"}
                </span>
                {u.title && (
                  <span className="max-w-[140px] truncate text-xs text-muted-foreground" title={u.title}>
                    {u.title}
                  </span>
                )}
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
        Баланс и расход подтягиваются из HeyGen API автоматически.
        Оценка ролика: Video Agent ${RATE_USD_PER_MIN.agent}/мин, аватар ${RATE_USD_PER_MIN.avatar}/мин.
      </p>
    </section>
  );
}
