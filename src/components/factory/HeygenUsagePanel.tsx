import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2, Wallet } from "lucide-react";
import { PeriodPicker, monthRange } from "@/components/dashboard/PeriodPicker";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { fetchAccountStats, fetchRecentVideos } from "@/hooks/useHeygen";
import { fetchUsage, RATE_USD_PER_MIN } from "@/lib/heygenUsage";
import {
  formatHeygenBalance,
  formatHeygenUsd,
  isInReportPeriod,
  remoteVideosForPeriod,
  resolveAccountSpent,
} from "@/lib/heygenAccount";

const MODE_LABEL: Record<string, string> = {
  agent: "Быстро",
  avatar: "Аватар",
  template: "Шаблон",
  clips: "Клипы",
  heygen: "HeyGen",
};

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

const fmtRenderTime = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}м ${s}с` : `${s}с`;
};

// Панель «Баланс и расходы»: остаток из HeyGen API + расход за выбранный месяц.
export function HeygenUsagePanel({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState<ReportPeriodRange>(() => monthRange(new Date()));

  const accountQ = useQuery({
    queryKey: ["heygen-account"],
    queryFn: fetchAccountStats,
    staleTime: 60_000,
    retry: 1,
  });
  const videosQ = useQuery({
    queryKey: ["heygen-videos"],
    queryFn: () => fetchRecentVideos(100),
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

  const usageInPeriod = useMemo(
    () => usage.filter((u) => isInReportPeriod(u.created_at, period)),
    [usage, period],
  );

  const spentEstimate = resolveAccountSpent(account, videos, period);
  const accountSpent = spentEstimate.amount;
  const projectSpent = usageInPeriod.reduce((s, u) => s + (u.cost_usd ?? 0), 0);
  const remoteVideos = remoteVideosForPeriod(account, videos, period);

  const history = useMemo(() => {
    const local = usageInPeriod.map((u) => ({
      id: u.id,
      mode: u.mode,
      source: u.source,
      duration_sec: u.duration_sec,
      cost_usd: u.cost_usd,
      created_at: u.created_at,
      title: u.title ?? null,
      render_time_sec: u.render_time_sec ?? null,
    }));

    // Каждый ролик, сгенерированный через наш пайплайн (Быстро/агент), уже
    // попадает в local (пишет heygen-jobs-worker) и одновременно виден в
    // собственном списке видео аккаунта HeyGen (remote) — без фильтра он
    // задваивался бы в истории. ref_id у local хранит настоящий video_id
    // HeyGen (см. heygen-jobs-worker), так что сверяем именно по нему.
    const localRefIds = new Set(usageInPeriod.map((u) => u.ref_id).filter(Boolean));
    // Записи, сделанные до перехода на настоящий video_id, всё ещё хранят
    // старый session_id в ref_id и не совпадут с ним напрямую. Резервное
    // сопоставление по длительности (она у HeyGen точная и совпадает для
    // одного и того же ролика) + окну по времени — чтобы такие записи тоже
    // не задваивались задним числом.
    const isLikelyDuplicate = (v: (typeof remoteVideos)[number]) =>
      usageInPeriod.some((u) => {
        if (u.duration_sec == null || v.durationSec == null || v.createdAt == null) return false;
        const sameDuration = Math.abs(u.duration_sec - v.durationSec) < 0.05;
        const localTs = new Date(u.created_at).getTime() / 1000;
        const closeInTime = Number.isFinite(localTs) && Math.abs(localTs - v.createdAt) < 30 * 60;
        return sameDuration && closeInTime;
      });
    const remote = remoteVideos
      .filter((v) => !localRefIds.has(v.id) && !isLikelyDuplicate(v))
      .map((v) => ({
        id: `hg-${v.id}`,
        mode: "heygen",
        source: "heygen",
        duration_sec: v.durationSec,
        cost_usd: v.costUsd,
        created_at: v.createdAt ? new Date(v.createdAt * 1000).toISOString() : "",
        title: v.title,
        render_time_sec: null as number | null,
      }));

    return [...local, ...remote]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, 20);
  }, [usageInPeriod, remoteVideos]);

  const loading = accountQ.isLoading || videosQ.isLoading;

  return (
    <section className="mt-8 rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Wallet className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold">Баланс и расходы</h2>
        </div>
        <PeriodPicker range={period} onChange={setPeriod} />
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
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Потрачено за период
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums">
            {formatHeygenUsd(accountSpent)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {spentEstimate.label || "—"}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-border/40 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
        В MarkVision за период: <span className="font-semibold text-foreground">{fmtUsd(projectSpent)}</span>
        {" · "}
        роликов: {usageInPeriod.length}
      </div>

      {history.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">История за период</div>
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
                {u.render_time_sec != null && (
                  <span className="text-[10px] text-muted-foreground" title="Время генерации">
                    ⏱ {fmtRenderTime(u.render_time_sec)}
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
        Остаток — из HeyGen API. Расход API-кошелька считается с 7 июля 2026 (ролики по подписке не входят).
        С августа — оценка по роликам за выбранный месяц.
        Video Agent ${RATE_USD_PER_MIN.agent}/мин, аватар ${RATE_USD_PER_MIN.avatar}/мин.
      </p>
    </section>
  );
}
