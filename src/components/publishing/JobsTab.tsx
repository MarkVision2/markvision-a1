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
import { ExternalLink, ListTree, Loader2, RotateCcw, Search, X, XCircle } from "lucide-react";
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
import { JobDetailDialog } from "@/components/publishing/JobDetailDialog";
import { AWAITING_APPROVAL_CODE, jobActions, jobErrorHint, JOB_STATUS_META, PLATFORM_META, VERIFICATION_META, type PublishJob, type PublishJobStatus } from "@/lib/publishingClient";
import { fmtExact, fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

/** Статусы в порядке разбора очереди: сначала то, что требует внимания. */
const ORDER: PublishJobStatus[] = ["failed", "manual_review", "retry", "processing", "verifying", "pending", "published", "cancelled"];

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

/**
 * «Что происходит» — единственная колонка, ради которой сюда заходят.
 *
 * Раньше отказ прятался за значком ⚠ и оператор видел четыре одинаковые строки
 * «Ошибка», не понимая, чинить токен, файл или просто подождать. Теперь в
 * строке — разобранная причина, а сырое сообщение площадки и следующий шаг
 * лежат в подсказке.
 */
function JobOutcome({ job }: { job: PublishJob }) {
  const hint = jobErrorHint(job.error_code);
  const raw = job.error_message?.trim() || null;
  const { stale } = jobActions(job);

  if (job.status === "published") {
    return <span className="text-xs text-muted-foreground">Пост ушёл в аккаунт{job.attempts > 1 ? ` с ${job.attempts}-й попытки` : ""}.</span>;
  }
  // Удержано политикой AI — не ошибка площадки, а ворота согласования.
  if (job.status === "manual_review" && job.error_code === AWAITING_APPROVAL_CODE) {
    return <span className="text-xs text-amber-700 dark:text-amber-300">{raw || "Ждёт согласования: политика AI проекта"}</span>;
  }
  if (!raw && !hint) {
    const idle: Partial<Record<PublishJobStatus, string>> = {
      pending: "Ждёт своего слота — воркер заберёт задание, когда время подойдёт.",
      verifying: "Пост ушёл, идёт проверка: видим ли мы его у площадки.",
      retry: "Повторная попытка запланирована.",
      processing: stale ? "Воркер не отвечает больше 10 минут — задание можно повторить." : "Воркер публикует прямо сейчас.",
      manual_review: "Площадка не приняла публикацию автоматически — нужен ручной разбор.",
      cancelled: "Задание отменено вручную.",
    };
    return <span className="text-xs text-muted-foreground">{idle[job.status] ?? "—"}</span>;
  }

  const tone = job.status === "failed" ? "text-destructive" : "text-amber-600 dark:text-amber-400";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="min-w-0 cursor-help space-y-0.5">
          <div className={cn("truncate text-xs font-medium", tone)}>{hint?.title ?? raw}</div>
          <div className="truncate text-xs text-muted-foreground">{hint ? raw : job.error_code ? `код площадки ${job.error_code}` : "\u00A0"}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="space-y-1 text-xs">
          {hint && <div className="font-medium">{hint.title}</div>}
          {raw && <div className="break-words text-muted-foreground">Ответ площадки: {raw}</div>}
          {(job.error_code || job.error_class) && (
            <div className="text-muted-foreground">
              Код: {[job.error_class, job.error_code].filter(Boolean).join(" / ")}
            </div>
          )}
          {hint && <div>{hint.action}</div>}
          {job.attempts > 0 && <div className="text-muted-foreground">Попыток: {job.attempts}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function JobsTab({ pub }: { pub: UsePublishing }) {
  const busy = pub.busy != null;
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };
  // Счётчики приходят с сервера по всей очереди: страница отдаёт максимум 500
  // заданий, и считать чипы по ней значило показывать «Ошибка 3» при сотне.
  const counts = pub.jobCounts ?? {};

  const visible = useMemo(() => pub.jobs.filter((j) => jobMatches(j, q)), [pub.jobs, q]);

  /**
   * Причина у пачки обычно одна (протух токен, площадка лежала), а кликать
   * «Повторить» тридцать семь раз невозможно. Фильтр по видео уважаем: из
   * очереди одного ролика повторяем только его.
   */
  const retryAllFailed = async () => {
    const scope = pub.jobsVideo ? "по этому видео" : "в проекте";
    if (!window.confirm(`Повторить все упавшие задания ${scope} (${counts.failed ?? 0})?`)) return;
    try {
      const r = await pub.jobsRetryFailed(pub.jobsVideo);
      if (r.skipped) toast.warning(`Возвращено в очередь ${r.retried}, пропущено ${r.skipped}`);
      else toast.success(`Возвращено в очередь: ${r.retried}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };
  const videoFilter = pub.jobsVideo ? pub.metrics?.videos?.find((v) => v.id === pub.jobsVideo) ?? null : null;

  /** Согласование AI-публикаций: одобрить или отклонить всё удержанное (в рамках фильтра по видео). */
  const decideAll = async (kind: "approve" | "reject") => {
    const n = counts.awaiting_approval ?? 0;
    const scope = pub.jobsVideo ? "по этому видео" : "в проекте";
    const verb = kind === "approve" ? "Согласовать" : "Отклонить";
    if (!window.confirm(`${verb} все публикации от AI ${scope} (${n})?`)) return;
    try {
      const r = kind === "approve" ? await pub.jobsApprove({ video_id: pub.jobsVideo }) : await pub.jobsReject({ video_id: pub.jobsVideo });
      const done = kind === "approve" ? r.approved : r.rejected;
      if (r.skipped) toast.warning(`${verb}: ${done}, пропущено ${r.skipped}`);
      else toast.success(kind === "approve" ? `В очередь: ${done}` : `Отклонено: ${done}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const filters: { value: PublishJobStatus | "all"; label: string; count: number }[] = [
    { value: "all", label: "Все", count: counts.all ?? pub.jobs.length },
    ...ORDER.map((s) => ({ value: s, label: JOB_STATUS_META[s].label, count: counts[s] ?? 0 })),
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        {(counts.awaiting_approval ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" role="status">
            <span>
              Ждут согласования: <b className="tabular-nums">{counts.awaiting_approval}</b> — публикации поставил AI-агент или внешняя система по API,
              политика проекта требует подтверждения человека.
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button type="button" size="sm" className="h-8" disabled={busy} onClick={() => void decideAll("approve")}>
                {pub.busy === "jobs_approve" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Согласовать все
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void decideAll("reject")}>
                {pub.busy === "jobs_reject" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Отклонить все
              </Button>
            </div>
          </div>
        )}
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
                {f.count > 0 && (
                  <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", active ? "bg-background/70" : "bg-muted")}>{f.count}</span>
                )}
              </Button>
            );
          })}
          {(counts.failed ?? 0) > 1 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy}
              onClick={() => void retryAllFailed()}
            >
              {pub.busy === "jobs_retry_failed" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
              Повторить все упавшие
            </Button>
          )}
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
            {/* Фиксированная раскладка: свободное место достаётся колонке
                «Что происходит», а не пустому хвосту, и длинный ответ площадки
                не распирает таблицу. Минимум 1300px: на узком экране колонка
                причины иначе схлопывалась в столбик по букве. */}
            <Table className="min-w-[1300px] table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 w-[130px]">Статус</TableHead>
                  <TableHead className="h-9 w-[220px]">Аккаунт</TableHead>
                  <TableHead className="h-9 w-[160px]">Видео</TableHead>
                  <TableHead className="h-9">Что происходит</TableHead>
                  <TableHead className="h-9 w-[120px] whitespace-nowrap">Когда</TableHead>
                  <TableHead className="h-9 w-[100px]">Пост</TableHead>
                  {/* Действия липнут к правому краю: на узком экране «Повторить»
                      уезжало за границу прокрутки, и строку было нечем чинить.
                      Попытки переехали в подсказку «Что происходит». */}
                  <TableHead className="sticky right-0 z-10 h-9 w-[320px] bg-card shadow-[inset_1px_0_0_hsl(var(--border))]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((j) => {
                  const st = JOB_STATUS_META[j.status] ?? JOB_STATUS_META.pending;
                  const acc = j.publish_accounts;
                  return (
                    <TableRow key={j.id}>
                      <TableCell className="py-2">
                        {/* Отказ разобран в колонке «Что происходит», здесь —
                            только статус и отметка проверки поста у площадки. */}
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className={cn("whitespace-nowrap border-transparent font-medium", st.cls)}>{st.label}</Badge>
                          {j.status === "published" && j.verification_status && j.verification_status !== "verified" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span tabIndex={0} className={cn("cursor-help text-xs", VERIFICATION_META[j.verification_status].cls)}>
                                  {j.verification_status === "unverified" ? "⚠" : "·"}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {VERIFICATION_META[j.verification_status].label}: {VERIFICATION_META[j.verification_status].hint}
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
                      <TableCell className="py-2 text-sm">
                        {j.publish_videos ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="block cursor-help truncate">
                                {j.publish_videos.title || j.publish_videos.file_url.split("/").pop()}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm break-all">{j.publish_videos.file_url}</TooltipContent>
                          </Tooltip>
                        ) : <span className="text-muted-foreground">видео удалено</span>}
                      </TableCell>

                      {/* Ради этой колонки вкладку и открывают: почему задание встало.
                          Ширина фиксирована: длинный ответ площадки иначе распирал
                          таблицу и выталкивал кнопки за край прокрутки. */}
                      <TableCell className="py-2"><JobOutcome job={j} /></TableCell>

                      <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                        {j.status === "published" && j.published_at ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="cursor-help">{fmtRelative(j.published_at)}</span>
                            </TooltipTrigger>
                            <TooltipContent>Опубликовано {fmtExact(j.published_at)}</TooltipContent>
                          </Tooltip>
                        ) : j.scheduled_at ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="cursor-help">{fmtRelative(j.scheduled_at)}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {Date.parse(j.scheduled_at) > Date.now() ? "Слот публикации" : "Слот прошёл"}: {fmtExact(j.scheduled_at)}
                            </TooltipContent>
                          </Tooltip>
                        ) : "—"}
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
                      <TableCell className="sticky right-0 z-10 whitespace-nowrap bg-card py-2 text-right shadow-[inset_1px_0_0_hsl(var(--border))]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground"
                              aria-label={`Трасса ${acc?.account_name ?? ""}`}
                              onClick={() => setOpenJob(j.id)}
                            >
                              <ListTree className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Шаги задания: что делал воркер и что ответила площадка</TooltipContent>
                        </Tooltip>
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
        <JobDetailDialog projectId={pub.projectId} jobId={openJob} onClose={() => setOpenJob(null)} />
      </div>
    </TooltipProvider>
  );
}
