/**
 * «Задания» — очередь публикаций.
 *
 * Фильтр статуса — полоса чипов со счётчиками вместо выпадающего списка:
 * оператор ищет здесь ошибки, и число рядом со статусом видно до клика.
 * Поиск по аккаунту, видео и тексту ошибки — по загруженной выборке; фильтр
 * «видео» приходит из библиотеки; хвост подгружается «Показать ещё»
 * (сервер отдаёт до 500). Ошибка живёт в подсказке, а не третьей строкой в ячейке.
 */
import { useMemo, useState } from "react";
import { ExternalLink, RotateCcw, Search, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { initials } from "@/components/publishing/PostPreview";
import { videoLabel } from "@/components/publishing/VideosTab";
import type { UsePublishing } from "@/hooks/usePublishing";
import { jobActions, JOB_STATUS_META, PLATFORM_META, type PublishJob, type PublishJobStatus } from "@/lib/publishingClient";
import { fmtExact, fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

/** Статусы в порядке разбора очереди: сначала то, что требует внимания. */
const ORDER: PublishJobStatus[] = ["failed", "manual_review", "retry", "processing", "pending", "published", "cancelled"];

/** Подстрока без учёта регистра по аккаунту, нику, площадке, видео и ошибке. */
export function jobMatches(j: PublishJob, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [
    j.publish_accounts?.account_name,
    j.publish_accounts?.handle,
    PLATFORM_META[j.platform]?.label,
    j.platform,
    j.publish_videos?.title,
    j.publish_videos?.file_url?.split("/").pop(),
    j.error_code,
    j.error_message,
  ];
  return hay.some((v) => v && v.toLowerCase().includes(s));
}

export function JobsTab({ pub }: { pub: UsePublishing }) {
  const busy = pub.busy != null;
  const [q, setQ] = useState("");
  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };
  // Счётчики по загруженной выборке — подсказка, а не точная статистика:
  // при фильтре по статусу видно только его, поэтому «все» показываем всегда.
  const counts = useMemo(() => {
    const m = new Map<PublishJobStatus, number>();
    for (const j of pub.jobs) m.set(j.status, (m.get(j.status) ?? 0) + 1);
    return m;
  }, [pub.jobs]);

  const visible = useMemo(() => pub.jobs.filter((j) => jobMatches(j, q)), [pub.jobs, q]);
  const videoFilter = pub.jobsVideo ? pub.metrics?.videos?.find((v) => v.id === pub.jobsVideo) ?? null : null;

  const filters: { value: PublishJobStatus | "all"; label: string; count: number | null }[] = [
    { value: "all", label: "Все", count: pub.jobsStatus === "all" ? pub.jobs.length : null },
    ...ORDER.map((s) => ({
      value: s,
      label: JOB_STATUS_META[s].label,
      count: pub.jobsStatus === "all" ? (counts.get(s) ?? 0) : pub.jobsStatus === s ? pub.jobs.length : null,
    })),
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f) => {
            const active = pub.jobsStatus === f.value;
            return (
              <Button
                key={f.value}
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                className={cn("h-8", !active && "text-muted-foreground")}
                onClick={() => pub.setJobsStatus(f.value)}
              >
                {f.label}
                {f.count != null && f.count > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums">{f.count}</span>
                )}
              </Button>
            );
          })}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Аккаунт, видео, ошибка…"
              aria-label="Поиск по заданиям"
              className="h-8 pl-8"
            />
          </div>
        </div>

        {pub.jobsVideo && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Только видео:</span>
            <Badge variant="secondary" className="max-w-[24rem] gap-1 pr-1 font-normal">
              <span className="truncate">{videoFilter ? videoLabel(videoFilter) : pub.jobsVideo}</span>
              <button
                type="button"
                aria-label="Снять фильтр по видео"
                className="rounded-full p-0.5 hover:bg-background/60"
                onClick={() => pub.setJobsVideo(null)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

        {!pub.jobs.length ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {pub.jobsVideo
              ? "По этому видео заданий нет."
              : pub.jobsStatus === "all"
                ? "Заданий нет — они появятся после «Залить видео» или из конвейера контента."
                : "В этом статусе заданий нет."}
          </div>
        ) : !visible.length ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Ничего не найдено по «{q.trim()}» среди загруженных заданий.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 w-[150px]">Статус</TableHead>
                  <TableHead className="h-9">Аккаунт</TableHead>
                  <TableHead className="h-9">Видео</TableHead>
                  <TableHead className="h-9 w-[130px]">Запланировано</TableHead>
                  <TableHead className="h-9 w-[70px] text-right">Попыток</TableHead>
                  <TableHead className="h-9 w-[90px]">Пост</TableHead>
                  <TableHead className="h-9 w-[190px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((j) => {
                  const st = JOB_STATUS_META[j.status] ?? JOB_STATUS_META.pending;
                  const acc = j.publish_accounts;
                  const failed = j.error_code || j.error_message;
                  return (
                    <TableRow key={j.id}>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className={cn("whitespace-nowrap border-transparent font-medium", st.cls)}>{st.label}</Badge>
                          {failed && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0} aria-label={`Ошибка задания ${acc?.account_name ?? ""}`} className="cursor-help text-xs text-destructive">⚠</span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {j.error_code && <code className="mr-1">{j.error_code}</code>}
                                {j.error_message}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarFallback className="text-[10px]">{initials(acc?.account_name ?? "?")}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{acc?.account_name ?? "—"}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {acc?.handle ? `@${acc.handle} · ` : ""}{PLATFORM_META[j.platform]?.label ?? j.platform}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] py-2 text-sm">
                        <span className="block truncate" title={j.publish_videos?.file_url}>
                          {j.publish_videos?.title || j.publish_videos?.file_url?.split("/").pop() || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {j.scheduled_at ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="cursor-help">{fmtRelative(j.scheduled_at)}</span>
                            </TooltipTrigger>
                            <TooltipContent>{fmtExact(j.scheduled_at)}</TooltipContent>
                          </Tooltip>
                        ) : "—"}
                      </TableCell>
                      <TableCell className={cn("py-2 text-right text-sm tabular-nums", j.attempts > 1 && "text-amber-600 dark:text-amber-400")}>
                        {j.attempts || "—"}
                      </TableCell>
                      <TableCell className="py-2">
                        {j.external_post_url ? (
                          <a
                            href={j.external_post_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            Открыть <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : <span className="text-muted-foreground">—</span>}
                        {j.metrics_unavailable_reason && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} aria-label="Метрики по посту недоступны" className="ml-2 cursor-help text-xs text-muted-foreground">без метрик</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              Площадка не отдаёт статистику по этому посту: {j.metrics_unavailable_reason}. Переподключение аккаунта снимет пометку.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        {jobActions(j).stale && (
                          <span className="mr-1 text-xs text-amber-600 dark:text-amber-400" title="Воркер не отвечает больше 10 минут">зависло</span>
                        )}
                        {jobActions(j).retry && (
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2" disabled={busy}
                            aria-label={`Повторить ${acc?.account_name ?? ""}`}
                            onClick={() => void act("Задание поставлено в очередь", () => pub.jobRetry(j.id))}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Повторить
                          </Button>
                        )}
                        {jobActions(j).cancel && (
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" disabled={busy}
                            aria-label={`Отменить ${acc?.account_name ?? ""}`}
                            onClick={() => void act("Задание отменено", () => pub.jobCancel(j.id))}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" /> Отменить
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {pub.jobsHasMore && (
          <div className="flex justify-center">
            <Button type="button" variant="outline" size="sm" onClick={() => pub.loadMoreJobs()}>
              Показать ещё
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
