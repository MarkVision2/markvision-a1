/**
 * Радар идей: вкладка «Сборы» — журнал запусков сборщика: статус, что
 * собирали, провайдер, элементов/новых, стоимость, ошибка, время.
 */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RUN_STATUS_META, type RadarRun, type RadarSource } from "@/lib/radarClient";
import { Chip, Empty, fmtDate, fmtUsd, PlatformChip } from "./RadarBits";
import { sourceTitle } from "./SourcesTab";

interface RunsTabProps {
  runs: RadarRun[];
  sourcesById: Map<string, RadarSource>;
}

function shortUrl(url: string): string {
  const s = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "");
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

function RunTarget({ run, source }: { run: RadarRun; source: RadarSource | undefined }) {
  if (run.mode === "url" && run.url) {
    return (
      <a href={run.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline" title={run.url}>
        {shortUrl(run.url)}
      </a>
    );
  }
  if (source) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{sourceTitle(source)}</span>
        <PlatformChip platform={source.platform} short />
      </span>
    );
  }
  return <span className="text-muted-foreground">источник удалён</span>;
}

export function RunsTab({ runs, sourcesById }: RunsTabProps) {
  if (runs.length === 0) return <Empty>Сборов ещё не было — они появятся после первого запуска сборщика.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Статус</TableHead>
            <TableHead>Что собирали</TableHead>
            <TableHead>Провайдер</TableHead>
            <TableHead>Элементов</TableHead>
            <TableHead>Новых</TableHead>
            <TableHead>Стоимость</TableHead>
            <TableHead>Ошибка</TableHead>
            <TableHead>Начало</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const meta = RUN_STATUS_META[run.status] ?? RUN_STATUS_META.done;
            return (
              <TableRow key={run.id}>
                <TableCell><Chip label={meta.label} cls={meta.cls} /></TableCell>
                <TableCell><RunTarget run={run} source={run.source_id ? sourcesById.get(run.source_id) : undefined} /></TableCell>
                <TableCell className="font-medium">{run.provider}</TableCell>
                <TableCell className="tabular-nums">{run.items}</TableCell>
                <TableCell className="tabular-nums">{run.inserted}</TableCell>
                <TableCell className="tabular-nums">{fmtUsd(run.cost_usd)}</TableCell>
                <TableCell className="max-w-[280px]">
                  {run.error && <span className="line-clamp-2 text-xs text-destructive" title={run.error}>{run.error}</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(run.started_at)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
