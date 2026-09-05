/**
 * Панель одного задания: трасса шагов воркера по времени (publish_job_events),
 * верификация, класс ошибки, сырые записи журнала и снятые метрики.
 * Это «admin log» публикации из ТЗ: 13:59 JOB_CREATED … 14:04 VERIFIED.
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  JOB_STATUS_META,
  PLATFORM_META,
  publishingApi,
  TRACE_STEP_LABELS,
  VERIFICATION_META,
  type JobDetail,
} from "@/lib/publishingClient";
import { fmtExact } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const LEVEL_DOT: Record<string, string> = {
  info: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

export function stepLabel(step: string): string {
  return TRACE_STEP_LABELS[step] ?? step;
}

export function JobDetailDialog({ projectId, jobId, onClose }: { projectId: string | null; jobId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !jobId) { setDetail(null); setError(null); return; }
    let alive = true;
    setLoading(true);
    publishingApi.jobGet(projectId, jobId)
      .then((d) => { if (alive) { setDetail(d); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Не удалось загрузить задание"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, jobId]);

  const job = detail?.job;
  const st = job ? (JOB_STATUS_META[job.status] ?? JOB_STATUS_META.pending) : null;
  const ver = job?.verification_status ? VERIFICATION_META[job.verification_status] : null;

  return (
    <Dialog open={Boolean(jobId)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Задание публикации
            {st && <Badge variant="outline" className={cn("border-transparent font-medium", st.cls)}>{st.label}</Badge>}
            {ver && job?.status === "published" && (
              <span className={cn("text-xs font-normal", ver.cls)} title={ver.hint}>{ver.label}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {job ? (
              <>
                {job.publish_accounts?.account_name ?? "—"}
                {job.publish_accounts?.handle ? ` (@${job.publish_accounts.handle})` : ""} · {PLATFORM_META[job.platform]?.label ?? job.platform}
                {job.publish_videos?.title ? ` · ${job.publish_videos.title}` : ""}
              </>
            ) : loading ? "Загрузка…" : error ?? ""}
          </DialogDescription>
        </DialogHeader>

        {job && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <dt className="text-muted-foreground">Запланировано</dt><dd className="sm:col-span-2">{job.scheduled_at ? fmtExact(job.scheduled_at) : "—"}</dd>
              <dt className="text-muted-foreground">Попыток</dt><dd className="sm:col-span-2">{job.attempts}{job.verify_attempts ? ` · проверок ${job.verify_attempts}` : ""}</dd>
              {job.error_class && (
                <><dt className="text-muted-foreground">Класс ошибки</dt><dd className="sm:col-span-2"><code>{job.error_class}</code>{job.error_code ? <span className="text-muted-foreground"> · {job.error_code}</span> : null}</dd></>
              )}
              {job.error_message && (
                <><dt className="text-muted-foreground">Ошибка</dt><dd className="sm:col-span-2 break-words">{job.error_message}</dd></>
              )}
              {job.external_post_url && (
                <><dt className="text-muted-foreground">Пост</dt><dd className="sm:col-span-2"><a href={job.external_post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Открыть <ExternalLink className="h-3 w-3" /></a></dd></>
              )}
              {job.trace_id && (
                <><dt className="text-muted-foreground">Трасса</dt><dd className="sm:col-span-2"><code className="text-[11px]">{job.trace_id}</code></dd></>
              )}
            </dl>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Шаги</h4>
              {detail.events.length ? (
                <ScrollArea className="max-h-64 rounded-xl border">
                  <ol className="divide-y">
                    {detail.events.map((e) => (
                      <li key={e.id} className="flex items-start gap-3 px-3 py-1.5">
                        <span className="w-[62px] shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{fmtExact(e.created_at).split(" ").pop()}</span>
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", LEVEL_DOT[e.level] ?? "bg-muted")} aria-hidden />
                        <div className="min-w-0">
                          <div className="font-medium">{stepLabel(e.step)} <code className="ml-1 text-[10px] text-muted-foreground">{e.step}</code></div>
                          {e.message && <div className="break-words text-xs text-muted-foreground">{e.message}</div>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </ScrollArea>
              ) : (
                <p className="text-xs text-muted-foreground">Шагов пока нет: задание ещё не бралось воркером или создано до включения трассы.</p>
              )}
            </section>

            {detail.metrics.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Метрики</h4>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground"><tr><th className="px-2 py-1 text-left">Точка</th><th className="px-2 py-1 text-right">Показы</th><th className="px-2 py-1 text-right">Охват</th><th className="px-2 py-1 text-right">Лайки</th><th className="px-2 py-1 text-right">Комм.</th><th className="px-2 py-1 text-right">Репосты</th><th className="px-2 py-1 text-right">Сохр.</th></tr></thead>
                    <tbody>
                      {detail.metrics.map((m) => (
                        <tr key={m.checkpoint} className="border-t tabular-nums"><td className="px-2 py-1">{m.checkpoint}</td><td className="px-2 py-1 text-right">{m.views}</td><td className="px-2 py-1 text-right">{m.reach}</td><td className="px-2 py-1 text-right">{m.likes}</td><td className="px-2 py-1 text-right">{m.comments}</td><td className="px-2 py-1 text-right">{m.shares}</td><td className="px-2 py-1 text-right">{m.saves}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {detail.logs.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Журнал площадки</h4>
                <ScrollArea className="max-h-40 rounded-xl border">
                  <ul className="divide-y text-xs">
                    {detail.logs.map((l) => (
                      <li key={l.id} className={cn("px-3 py-1.5", l.level === "error" && "text-destructive")}>
                        <span className="mr-2 tabular-nums text-muted-foreground">{fmtExact(l.created_at).split(" ").pop()}</span>{l.message}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </section>
            )}
          </div>
        )}
        {!job && error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
