/**
 * «Сеть» — сводка по группам аккаунтов (витрина publish_group_metrics).
 *
 * Числа выровнены по правому краю и моноширинно: столбец, который читают
 * сравнением, нельзя рвать по левому краю. Цвета — с dark:-вариантами:
 * text-emerald-700 на тёмной теме сливался с фоном.
 */
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PLATFORM_META,
  REVIEW_MODE_META,
  healthTone,
  type GroupMetrics,
} from "@/lib/publishingClient";
import { fmtExact, fmtNum, fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const HEALTH_TEXT = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
} as const;

export function NetworkTab({ rows }: { rows: GroupMetrics[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Групп аккаунтов пока нет — создайте их во вкладке «Группы», и здесь появится сводка по каждой.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-x-auto rounded-2xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9">Группа</TableHead>
              <TableHead className="h-9 w-[110px] text-right">Аккаунты</TableHead>
              <TableHead className="h-9 w-[90px] text-right">Здоровье</TableHead>
              <TableHead className="h-9 w-[90px] text-right">Очередь</TableHead>
              <TableHead className="h-9 w-[110px] text-right">За 7 дней</TableHead>
              <TableHead className="h-9 w-[110px] text-right">Охват d3</TableHead>
              <TableHead className="h-9 w-[150px] whitespace-nowrap">Ближайший слот</TableHead>
              <TableHead className="h-9 w-[130px] whitespace-nowrap text-right">Одобрено тем</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((g) => {
              const review = REVIEW_MODE_META[g.review_mode];
              const platform = g.platform ? PLATFORM_META[g.platform] : null;
              const tone = healthTone(g.health_avg);
              return (
                <TableRow key={g.group_id}>
                  <TableCell className="py-2">
                    <div className="text-sm font-medium">{g.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {platform && (
                        <Badge variant="outline" className={cn("border-transparent px-1.5 py-0 text-[10px]", platform.cls)}>{platform.label}</Badge>
                      )}
                      {review && (
                        <Badge variant="outline" className={cn("border-transparent px-1.5 py-0 text-[10px]", review.cls)}>{review.label}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right text-sm tabular-nums">
                    {g.accounts_active} / {g.accounts_total}
                    {g.accounts_token_expired > 0 && (
                      <div className="text-xs text-amber-600 dark:text-amber-400">токен истёк: {g.accounts_token_expired}</div>
                    )}
                  </TableCell>
                  <TableCell className={cn("py-2 text-right text-sm font-medium tabular-nums", g.health_avg != null && HEALTH_TEXT[tone])}>
                    {g.health_avg == null ? "—" : `${Math.round(g.health_avg)}%`}
                  </TableCell>
                  <TableCell className="py-2 text-right text-sm tabular-nums">{g.jobs_queued || "—"}</TableCell>
                  <TableCell className="py-2 text-right text-sm tabular-nums">
                    <span className="text-emerald-600 dark:text-emerald-400">{g.published_7d}</span>
                    {g.failed_7d > 0 && <span className="ml-2 text-destructive">✗{g.failed_7d}</span>}
                  </TableCell>
                  <TableCell className="py-2 text-right text-sm tabular-nums">{g.reach_d3_7d ? fmtNum(g.reach_d3_7d) : "—"}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {g.next_slot_at ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="cursor-help">{fmtRelative(g.next_slot_at)}</span>
                        </TooltipTrigger>
                        <TooltipContent>{fmtExact(g.next_slot_at)}</TooltipContent>
                      </Tooltip>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="py-2 text-right text-sm tabular-nums">{g.items_approved || "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
