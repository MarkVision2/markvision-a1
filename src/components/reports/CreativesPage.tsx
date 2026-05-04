import type { ReportData } from "@/hooks/useReportData";
import { ReportPageWrapper } from "./ReportPageWrapper";
import { SectionTitle } from "./SectionTitle";
import { reportFmt } from "./MarketingPage";

interface Props {
  data: ReportData;
  rangeLabel: string;
}

export function CreativesPage({ data, rangeLabel }: Props) {
  return (
    <ReportPageWrapper
      title="Все проекты"
      rangeLabel={rangeLabel}
      pageNumber={2}
      pageTotal={3}
      rightLabel="Креативы и каналы"
    >
      <SectionTitle>Топ креативов</SectionTitle>
      {data.creatives.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 bg-secondary/10 p-10 text-center text-sm italic text-muted-foreground">
          Креативы не найдены в базе данных
        </div>
      ) : (
        <div className="space-y-2">
          {data.creatives.slice(0, 5).map((c) => (
            <div key={c.name} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 rounded-xl border border-border/40 bg-card/40 px-4 py-3 text-sm">
              <span className="truncate font-medium">{c.name}</span>
              <span className="tabular-nums text-muted-foreground">{reportFmt.fmtNum(c.impressions)} показов</span>
              <span className="tabular-nums text-muted-foreground">{reportFmt.fmtNum(c.clicks)} кликов</span>
              <span className="tabular-nums font-bold text-success">CTR {c.ctr.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <SectionTitle>Каналы трафика</SectionTitle>
        {data.channels.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/50 bg-secondary/10 p-10 text-center text-sm italic text-muted-foreground">
            Каналы не настроены или нет данных
          </div>
        ) : (
          <div className="space-y-2">
            {data.channels.map((c) => (
              <div key={c.name} className="rounded-xl border border-border/40 bg-card/40 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.name}</span>
                  <span className="tabular-nums">
                    <span className="font-bold">{reportFmt.fmtNum(c.leads)}</span>
                    <span className="ml-2 text-muted-foreground">{c.share.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/30">
                  <div className="h-full bg-success/70" style={{ width: `${c.share}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ReportPageWrapper>
  );
}