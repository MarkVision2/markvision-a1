import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, Download, Film, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchActiveReelsJobs, fetchFinishedReels } from "@/lib/reelsQueue";
import { toast } from "sonner";

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  rendering: "Рендерится",
  error: "Ошибка",
};

// Готовые Reels проекта + активные задачи с прогрессом.
// Поллит, пока есть незавершённые задачи (воркер докручивает их на VPS).
export function ReelsGallery({ projectId }: { projectId: string }) {
  const jobs = useQuery({
    queryKey: ["reels-jobs", projectId],
    queryFn: () => fetchActiveReelsJobs(projectId),
    enabled: !!projectId,
    // пока есть активные — опрашиваем часто, иначе притормаживаем
    refetchInterval: (q) =>
      (q.state.data ?? []).some((j) => j.status === "queued" || j.status === "rendering") ? 6_000 : 20_000,
  });

  const finished = useQuery({
    queryKey: ["reels-finished", projectId],
    queryFn: () => fetchFinishedReels(projectId),
    enabled: !!projectId,
    staleTime: 15_000,
    // подтягиваем свежие готовые, пока что-то рендерится
    refetchInterval: () =>
      (jobs.data ?? []).some((j) => j.status === "queued" || j.status === "rendering") ? 8_000 : false,
  });

  const active = (jobs.data ?? []).filter((j) => j.status === "queued" || j.status === "rendering");
  const failed = (jobs.data ?? []).filter((j) => j.status === "error");
  const videos = finished.data ?? [];

  return (
    <section className="mt-8 rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Film className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold">Готовые Reels</h2>
        {(finished.isLoading || jobs.isLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Активные задачи — прогресс рендера */}
      {active.length > 0 && (
        <div className="mb-4 space-y-2">
          {active.map((j) => (
            <div key={j.id} className="rounded-xl border border-border/60 bg-background/40 p-3">
              <div className="flex items-center gap-2 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="font-semibold">{STATUS_LABEL[j.status] ?? j.status}</span>
                {j.stage && <span className="text-muted-foreground">· {j.stage}</span>}
                <span className="ml-auto tabular-nums text-muted-foreground">{j.progress ?? 0}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(Math.max(j.progress ?? 0, 3), 100)}%` }} />
              </div>
              {j.script && <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground">{j.script}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Упавшие задачи */}
      {failed.length > 0 && (
        <div className="mb-4 space-y-2">
          {failed.map((j) => (
            <div key={j.id} className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <div>
                <span className="font-semibold text-destructive">Рендер не удался</span>
                {j.error && <p className="mt-0.5 text-muted-foreground">{j.error}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {!finished.isLoading && videos.length === 0 && active.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Пока нет готовых Reels. Вставь сценарий выше и нажми «Сделать Reels» — ролик появится здесь.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => (
          <div key={v.id} className="overflow-hidden rounded-xl border border-border/60 bg-background/40">
            <video
              src={v.video_url ?? undefined}
              poster={v.cover_url ?? v.thumbnail_url ?? undefined}
              controls
              playsInline
              className="aspect-[9/16] w-full bg-black object-contain"
            />
            <div className="space-y-2 p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-md bg-secondary px-1.5 py-0.5 font-semibold">Reels</span>
                {v.duration_sec != null && (
                  <span className="text-muted-foreground">{Math.round(v.duration_sec)} с</span>
                )}
                {v.cost_usd != null && (
                  <span className="ml-auto tabular-nums text-muted-foreground">${v.cost_usd.toFixed(2)}</span>
                )}
              </div>

              {v.description && (
                <div className="rounded-lg border border-border/40 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Описание</span>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard?.writeText(v.description ?? "").then(
                          () => toast.success("Скопировано"),
                          () => toast.error("Не удалось"),
                        )
                      }
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" /> Копировать
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-xs">{v.description}</p>
                </div>
              )}

              <div className="flex gap-2">
                <a href={v.video_url ?? "#"} target="_blank" rel="noreferrer" download className="flex-1">
                  <Button variant="secondary" size="sm" className="w-full gap-2">
                    <Download className="h-4 w-4" /> Видео
                  </Button>
                </a>
                {v.cover_url && (
                  <a href={v.cover_url} target="_blank" rel="noreferrer" download className="flex-1">
                    <Button variant="outline" size="sm" className="w-full gap-2">
                      <Download className="h-4 w-4" /> Обложка
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
