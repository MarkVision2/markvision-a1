/**
 * «Календарь»: неделя × аккаунт — кто, когда и что публикует.
 *
 * Строка — аккаунт, колонка — день в его поясе; в ячейке фишки заданий со
 * временем и статусом, под ними загрузка «занято/лимит». Данные — одно
 * действие publish-accounts calendar за неделю (с запасом по суткам), раскладка —
 * src/lib/publishCalendar.ts. Клик по фишке открывает трассу задания.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { JobDetailDialog } from "@/components/publishing/JobDetailDialog";
import type { UsePublishing } from "@/hooks/usePublishing";
import {
  JOB_STATUS_META,
  PLATFORM_DOT,
  PLATFORM_META,
  publishingApi,
  type CalendarJob,
  type CalendarResponse,
  type PublishPlatform,
} from "@/lib/publishingClient";
import { buildCalendarGrid, calendarRange, DAY_MS, dayKeys, dayLabel, jobTime, weekStart } from "@/lib/publishCalendar";
import { cn } from "@/lib/utils";

const ANY = "__any";

/** Цвет фишки по статусу — те же оттенки, что чипы в «Заданиях». */
const CHIP_CLS: Record<CalendarJob["status"], string> = {
  pending: "border-border bg-background text-foreground",
  retry: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  processing: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  verifying: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  published: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  manual_review: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  cancelled: "border-border bg-muted text-muted-foreground line-through",
};

export function CalendarTab({ pub }: { pub: UsePublishing }) {
  const [start, setStart] = useState(() => weekStart());
  const [groupId, setGroupId] = useState<string>(ANY);
  const [platform, setPlatform] = useState<string>(ANY);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const days = useMemo(() => dayKeys(start), [start]);
  const todayKey = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    if (!pub.projectId) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await publishingApi.calendar(pub.projectId, { ...calendarRange(start), group_id: groupId === ANY ? null : groupId });
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить календарь");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [pub.projectId, start, groupId]);

  useEffect(() => { void load(); }, [load]);
  // Изменения очереди (повтор, отмена, новая публикация) — перечитываем без кнопки.
  useEffect(() => { if (data) void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [pub.jobs.length, pub.jobCounts.all]);

  const grid = useMemo(() => {
    if (!data) return null;
    const accounts = platform === ANY ? data.accounts : data.accounts.filter((a) => a.platform === platform);
    return buildCalendarGrid(accounts, data.jobs, days);
  }, [data, days, platform]);

  const weekTitle = `${dayLabel(days[0])} — ${dayLabel(days[6])}`;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 px-2" aria-label="Прошлая неделя" onClick={() => setStart((s) => new Date(s.getTime() - 7 * DAY_MS))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setStart(weekStart())}>Сегодня</Button>
            <Button size="sm" variant="outline" className="h-8 px-2" aria-label="Следующая неделя" onClick={() => setStart((s) => new Date(s.getTime() + 7 * DAY_MS))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="flex items-center gap-1.5 text-sm font-medium"><CalendarDays className="h-4 w-4 text-muted-foreground" /> {weekTitle}</span>

          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-8 w-[170px]" aria-label="Группа"><SelectValue placeholder="Все группы" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Все группы</SelectItem>
              {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-8 w-[150px]" aria-label="Площадка"><SelectValue placeholder="Все площадки" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Все площадки</SelectItem>
              {(Object.keys(PLATFORM_META) as PublishPlatform[]).map((p) => <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button size="sm" variant="ghost" className="ml-auto h-8" disabled={loading} onClick={() => void load()} aria-label="Обновить календарь">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {error && <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
        {data?.truncated && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Заданий за неделю больше 2000 — показана часть. Сузьте выбор группой.
          </div>
        )}

        {!grid && !error && (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground" aria-busy={loading}>
            {loading ? "Загружаем неделю…" : "Выберите проект"}
          </div>
        )}

        {grid && grid.rows.length === 0 && (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Нет аккаунтов под выбранный фильтр.
          </div>
        )}

        {grid && grid.rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[960px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="w-[200px] border-b px-3 py-2 text-left font-medium text-muted-foreground">Аккаунт</th>
                  {grid.days.map((d, i) => (
                    <th key={d} className={cn("border-b border-l px-2 py-2 text-left font-medium", d === todayKey ? "bg-primary/5 text-foreground" : "text-muted-foreground")}>
                      <div>{dayLabel(d)}</div>
                      <div className="font-normal tabular-nums text-muted-foreground">
                        {grid.totals[i].jobs}
                        {grid.totals[i].published > 0 && <span className="text-emerald-600 dark:text-emerald-400"> · ✓{grid.totals[i].published}</span>}
                        {grid.totals[i].failed > 0 && <span className="text-destructive"> · ✕{grid.totals[i].failed}</span>}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.account.id} className="align-top">
                    <td className="border-b px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", PLATFORM_DOT[row.account.platform])} aria-hidden />
                        <span className="truncate font-medium" title={row.account.account_name}>{row.account.account_name}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        {row.account.handle && <span>@{row.account.handle}</span>}
                        <span className="tabular-nums">лимит {row.account.daily_limit}/день</span>
                        {!row.account.publish_enabled && <span className="text-amber-700 dark:text-amber-300">выключен</span>}
                      </div>
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.day} className={cn("border-b border-l px-1.5 py-1.5", cell.day === todayKey && "bg-primary/5")}>
                        <div className="flex flex-col gap-1">
                          {cell.jobs.map((j) => (
                            <Tooltip key={j.id}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => setOpenJob(j.id)}
                                  aria-label={`Задание ${jobTime(j, row.timezone)} ${row.account.account_name}`}
                                  className={cn("flex w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-left leading-tight", CHIP_CLS[j.status])}
                                >
                                  <span className="tabular-nums">{jobTime(j, row.timezone)}</span>
                                  <span className="truncate text-[11px] opacity-80">{j.publish_videos?.title ?? "Ролик"}</span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                <div className="font-medium">{JOB_STATUS_META[j.status].label}</div>
                                <div>{j.publish_videos?.title ?? "Без названия"}</div>
                                {j.error_class && <div className="text-destructive">{j.error_class}</div>}
                                {j.campaign_id && <div className="text-muted-foreground">из кампании</div>}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                          <div className={cn("text-[11px] tabular-nums", cell.over ? "font-medium text-destructive" : cell.used >= cell.limit && cell.limit > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                            {cell.used}/{cell.limit}
                          </div>
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {grid && grid.orphans > 0 && (
          <div className="text-xs text-muted-foreground">Ещё {grid.orphans} заданий у аккаунтов, которых нет в этом списке (отключены или в другой группе).</div>
        )}

        <JobDetailDialog projectId={pub.projectId} jobId={openJob} onClose={() => setOpenJob(null)} />
      </div>
    </TooltipProvider>
  );
}
