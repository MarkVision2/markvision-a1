import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, Download, Film, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchFinishedVideos, fetchRecentAgentJobs, type AgentJobRow } from "@/lib/heygenUsage";
import { toast } from "sonner";

const MODE_LABEL: Record<string, string> = {
  agent: "Быстро", avatar: "Аватар", template: "Шаблон", clips: "Клипы",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  done: "Готово",
  failed: "Ошибка",
  timeout: "Таймаут",
  video_ready: "Видео готово, доставка…",
  pending: "В очереди",
  processing: "Монтируется",
  generating: "Монтируется",
};

function jobLabel(row: AgentJobRow): string {
  if (row.delivered && row.status === "done") return "Готово";
  if (row.error) return "Ошибка";
  if (row.status && JOB_STATUS_LABEL[row.status]) return JOB_STATUS_LABEL[row.status];
  if (!row.delivered) return "В очереди / монтируется";
  return row.status || "—";
}

function snippet(text: string | null | undefined, n = 90): string {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "—";
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

// «Готовый контент» — галерея готовых видео проекта (видео + обложка + описание)
// + очередь недавних заявок Video Agent (чтобы видеть зависшие/упавшие ТЗ).
export function HeygenGallery({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: ["heygen-finished", projectId],
    queryFn: () => fetchFinishedVideos(projectId),
    enabled: !!projectId,
    staleTime: 20_000,
  });

  const jobsQ = useQuery({
    queryKey: ["heygen-agent-jobs", projectId],
    queryFn: () => fetchRecentAgentJobs(projectId),
    enabled: !!projectId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const videos = q.data ?? [];
  const jobs = jobsQ.data ?? [];
  const activeJobs = jobs.filter((j) => !j.delivered || j.status === "failed" || j.status === "timeout" || !!j.error);

  return (
    <section className="mt-8 space-y-6">
      {activeJobs.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Очередь монтажа</h2>
            {jobsQ.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <ul className="space-y-2">
            {activeJobs.slice(0, 8).map((j) => {
              const bad = j.status === "failed" || j.status === "timeout" || !!j.error;
              return (
                <li
                  key={j.id}
                  className={`rounded-xl border p-3 text-xs ${
                    bad ? "border-destructive/30 bg-destructive/5" : "border-border/50 bg-background/40"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {bad && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{jobLabel(j)}</span>
                        <span className="text-muted-foreground">
                          {new Date(j.created_at).toLocaleString("ru-RU")}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{snippet(j.montage_brief || j.script)}</p>
                      {j.error && <p className="mt-1 text-destructive">{j.error}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Film className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold">Готовый контент</h2>
          {q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {!q.isLoading && videos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Пока нет готовых видео. Собери видео выше — оно появится здесь.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <div key={v.id} className="overflow-hidden rounded-xl border border-border/60 bg-background/40">
              <video
                src={v.video_url ?? undefined}
                poster={v.cover_url ?? v.thumbnail_url ?? undefined}
                controls
                className="aspect-video w-full bg-black object-contain"
              />
              <div className="space-y-2 p-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 font-semibold">{MODE_LABEL[v.mode] ?? v.mode}</span>
                  <span className="text-muted-foreground">{v.source === "telegram" ? "Telegram" : "Сайт"}</span>
                  {v.cost_usd != null && <span className="ml-auto tabular-nums text-muted-foreground">${v.cost_usd.toFixed(2)}</span>}
                </div>

                {v.description && (
                  <div className="rounded-lg border border-border/40 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Описание</span>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(v.description ?? "").then(
                          () => toast.success("Скопировано"), () => toast.error("Не удалось"))}
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
      </div>
    </section>
  );
}
