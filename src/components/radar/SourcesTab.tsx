/**
 * Радар идей: вкладка «Источники» — таблица аккаунтов/хештегов/запросов,
 * их расписание, последний сбор и ошибки; включение, сбор сейчас, удаление.
 */
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RUN_STATUS_META, SOURCE_KIND_META, type RadarSource } from "@/lib/radarClient";
import { cn } from "@/lib/utils";
import { Chip, Empty, fmtDate, PlatformChip } from "./RadarBits";

interface SourcesTabProps {
  sources: RadarSource[];
  runningSourceIds: Set<string>;
  postCounts: Map<string, number>;
  busy: string | null;
  onToggle: (source: RadarSource, enabled: boolean) => void;
  onCrawl: (source: RadarSource) => void;
  onDelete: (source: RadarSource) => void;
  onAdd: () => void;
}

export function sourceTitle(s: RadarSource): string {
  return s.kind === "ad_library_query" || /^https?:\/\//i.test(s.handle) ? s.handle : `@${s.handle}`;
}

export function SourcesTab({ sources, runningSourceIds, postCounts, busy, onToggle, onCrawl, onDelete, onAdd }: SourcesTabProps) {
  if (sources.length === 0) {
    return (
      <Empty action={<Button size="sm" className="gap-1" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Добавить источник</Button>}>
        Источников нет. Добавьте аккаунты конкурентов, хештеги или запрос в Библиотеке рекламы — радар будет собирать их по расписанию.
      </Empty>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Источник</TableHead>
            <TableHead>Тип</TableHead>
            <TableHead>Постов</TableHead>
            <TableHead>Интервал</TableHead>
            <TableHead>Последний сбор</TableHead>
            <TableHead>Состояние</TableHead>
            <TableHead>Вкл.</TableHead>
            <TableHead className="text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((s) => {
            const rowBusy = busy === "source" || busy === `crawl:${s.id}` || busy === `delete:${s.id}`;
            const running = runningSourceIds.has(s.id);
            return (
              <TableRow key={s.id} className={cn(!s.enabled && "opacity-60")}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <PlatformChip platform={s.platform} short />
                    <div className="min-w-0">
                      <div className="max-w-[260px] truncate font-semibold" title={s.handle}>{sourceTitle(s)}</div>
                      {s.label && <div className="truncate text-xs text-muted-foreground">{s.label}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell><Chip label={SOURCE_KIND_META[s.kind]?.label ?? s.kind} cls={SOURCE_KIND_META[s.kind]?.cls ?? ""} /></TableCell>
                <TableCell className="tabular-nums">{postCounts.get(s.id) ?? 0}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{s.crawl_interval_hours} ч</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {running ? <Chip label="Собираем…" cls={RUN_STATUS_META.running.cls} /> : fmtDate(s.last_crawled_at)}
                </TableCell>
                <TableCell className="max-w-[260px]">
                  {s.last_error
                    ? <span className="line-clamp-2 text-xs text-destructive" title={s.last_error}>{s.last_error}</span>
                    : <span className="text-xs text-success">ок</span>}
                </TableCell>
                <TableCell>
                  <Switch checked={s.enabled} disabled={rowBusy} aria-label={`Источник ${sourceTitle(s)} включён`} onCheckedChange={(v) => onToggle(s, v)} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" className="gap-1" disabled={rowBusy || running} onClick={() => onCrawl(s)}>
                    {busy === `crawl:${s.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Собрать сейчас
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 text-destructive" disabled={rowBusy} onClick={() => onDelete(s)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Удалить
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
