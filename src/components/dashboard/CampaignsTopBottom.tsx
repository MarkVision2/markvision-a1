import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReportCreative } from "@/hooks/useReportData";

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} $`;

interface Props {
  creatives: ReportCreative[];
}

export function CampaignsTopBottom({ creatives }: Props) {
  if (creatives.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-6 text-center">
        <div className="text-sm font-semibold">Топ кампаний / креативов</div>
        <div className="mt-2 text-xs text-muted-foreground">
          Подключите ad-level статистику в рекламном кабинете, чтобы видеть лучшие и худшие кампании по CPL и ROMI.
        </div>
      </div>
    );
  }

  const sorted = [...creatives].sort((a, b) => b.ctr - a.ctr);
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();

  const Block = ({ title, items, good }: { title: string; items: ReportCreative[]; good: boolean }) => (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        {good ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <div className="space-y-2">
        {items.map((c) => (
          <div key={c.name} className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-secondary/20 px-3 py-2 text-xs">
            <span className="truncate font-medium">{c.name}</span>
            <div className="flex shrink-0 items-center gap-3 tabular-nums text-muted-foreground">
              <span>CTR: <span className="font-semibold text-foreground">{c.ctr.toFixed(2)}%</span></span>
              <span>{fmtTenge(c.spend)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Block title="Топ-5 кампаний" items={top} good />
      <Block title="Худшие 5" items={bottom} good={false} />
    </div>
  );
}