import type { ReportData } from "@/hooks/useReportData";
import { ReportPageWrapper } from "./ReportPageWrapper";
import { SectionTitle } from "./SectionTitle";
import { reportFmt } from "./MarketingPage";

interface Props {
  data: ReportData;
  rangeLabel: string;
}

export function CreativesPage({ data, rangeLabel }: Props) {
  const top = data.creatives.slice(0, 5);

  return (
    <ReportPageWrapper
      title="Все проекты"
      rangeLabel={rangeLabel}
      pageNumber={2}
      pageTotal={3}
      rightLabel="Креативы и каналы"
    >
      <SectionTitle>Топ креативов по выручке CRM</SectionTitle>
      {top.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 bg-secondary/10 p-10 text-center text-sm italic text-muted-foreground">
          Креативы появятся после синхронизации Meta (<code className="rounded bg-secondary px-1 text-[11px] not-italic">meta-structure-sync</code>)
        </div>
      ) : (
        <div className="space-y-2">
          {top.map((c) => (
            <div
              key={c.adId}
              className="grid grid-cols-1 gap-2 rounded-xl border border-border/40 bg-card/40 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto_auto_auto]"
            >
              <span className="truncate font-medium" title={c.name}>{c.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {c.spend > 0 ? reportFmt.fmtTenge(c.spend) : "—"} расход
              </span>
              <span className="tabular-nums text-muted-foreground">
                {reportFmt.fmtNum(c.leads)} лидов
              </span>
              <span className="tabular-nums font-semibold">
                {c.crmRevenue > 0 ? reportFmt.fmtTenge(c.crmRevenue) : "нет продаж"}
              </span>
              <span className="tabular-nums font-bold text-success">
                CTR {c.ctr.toFixed(2)}%
              </span>
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
