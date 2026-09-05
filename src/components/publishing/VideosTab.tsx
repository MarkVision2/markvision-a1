/**
 * «Видео» — библиотека роликов проекта (publish_videos) с заданиями по каждому.
 *
 * Отсюда ролик выпускается второй раз («Опубликовать ещё» — тот же композер,
 * но без заливки файла) и открывается очередь именно по нему. Счётчики —
 * витрина publish_video_stats, приходит вместе с metrics.
 */
import { ExternalLink, ListChecks, Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { UsePublishing } from "@/hooks/usePublishing";
import type { PublishVideo } from "@/lib/publishingClient";
import { fmtExact, fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = {
  manual: "вручную",
  content_pipeline: "конвейер",
  n8n: "n8n",
  api: "API",
  montage: "монтаж",
  reels: "Reels",
};

/** Имя ролика: заголовок, иначе имя файла из ссылки. */
export function videoLabel(v: Pick<PublishVideo, "title" | "file_url">): string {
  if (v.title?.trim()) return v.title.trim();
  try {
    const name = decodeURIComponent(new URL(v.file_url).pathname.split("/").pop() ?? "");
    return name || v.file_url;
  } catch {
    return v.file_url.split("/").pop() || v.file_url;
  }
}

export function VideosTab({
  pub, onRepost, onShowJobs,
}: {
  pub: UsePublishing;
  onRepost: (video: PublishVideo) => void;
  onShowJobs: (video: PublishVideo) => void;
}) {
  const videos = pub.metrics?.videos ?? [];
  const busy = pub.busy != null;

  if (!videos.length) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Библиотека пуста — ролики появятся после «Залить видео», из конвейера контента или по API.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-x-auto rounded-2xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9">Видео</TableHead>
              <TableHead className="h-9 w-[220px]">Задания</TableHead>
              <TableHead className="h-9 w-[150px]">Последний пост</TableHead>
              <TableHead className="h-9 w-[150px]">Ближайший слот</TableHead>
              <TableHead className="h-9 w-[250px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {videos.map((v) => {
              const total = v.jobs_total ?? 0;
              const queued = v.queued ?? 0;
              const published = v.published ?? 0;
              const failed = v.failed ?? 0;
              const label = videoLabel(v);
              return (
                <TableRow key={v.id}>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-2.5">
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt="" className="h-10 w-7 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="h-10 w-7 shrink-0 rounded bg-muted" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium" title={label}>{label}</span>
                          <a href={v.file_url} target="_blank" rel="noreferrer" aria-label={`Открыть файл ${label}`} className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="outline" className="h-4 border-transparent bg-muted px-1.5 text-[10px] font-normal">
                            {SOURCE_LABEL[v.source] ?? v.source}
                          </Badge>
                          <Tooltip>
                            <TooltipTrigger asChild><span tabIndex={0} className="cursor-help">{fmtRelative(v.created_at)}</span></TooltipTrigger>
                            <TooltipContent>{fmtExact(v.created_at)}</TooltipContent>
                          </Tooltip>
                          {v.duration_sec != null && <span>· {Math.round(Number(v.duration_sec))} с</span>}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    {total === 0 ? (
                      <span className="text-xs text-muted-foreground">ещё не публиковался</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1 text-xs tabular-nums">
                        {published > 0 && <Badge variant="outline" className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">{published} опубл.</Badge>}
                        {queued > 0 && <Badge variant="outline" className="border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300">{queued} в очереди</Badge>}
                        {failed > 0 && <Badge variant="outline" className="border-transparent bg-destructive/15 text-destructive">{failed} с ошибкой</Badge>}
                        <span className="text-muted-foreground">из {total}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {v.last_published_at ? (
                      <Tooltip>
                        <TooltipTrigger asChild><span tabIndex={0} className="cursor-help">{fmtRelative(v.last_published_at)}</span></TooltipTrigger>
                        <TooltipContent>{fmtExact(v.last_published_at)}</TooltipContent>
                      </Tooltip>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {v.next_scheduled_at ? (
                      <Tooltip>
                        <TooltipTrigger asChild><span tabIndex={0} className="cursor-help">{fmtRelative(v.next_scheduled_at)}</span></TooltipTrigger>
                        <TooltipContent>{fmtExact(v.next_scheduled_at)}</TooltipContent>
                      </Tooltip>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <Button
                      size="sm" variant="ghost" className={cn("h-7 px-2", total === 0 && "text-primary")} disabled={busy}
                      aria-label={`Опубликовать ещё ${label}`}
                      onClick={() => onRepost(v)}
                    >
                      <Repeat2 className="mr-1 h-3.5 w-3.5" /> {total === 0 ? "Опубликовать" : "Опубликовать ещё"}
                    </Button>
                    {total > 0 && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground"
                        aria-label={`Задания по видео ${label}`}
                        onClick={() => onShowJobs(v)}
                      >
                        <ListChecks className="mr-1 h-3.5 w-3.5" /> Задания
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
