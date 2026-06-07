import { Radio } from "lucide-react";
import type { ReportChannel } from "@/hooks/useReportData";
import { reportFmt } from "./reportFormat";

interface Props {
  channels: ReportChannel[];
}

const CHANNEL_COLORS = [
  "from-emerald-500/80 to-emerald-600/50",
  "from-teal-500/75 to-teal-600/45",
  "from-cyan-500/70 to-cyan-600/40",
  "from-sky-500/65 to-sky-600/35",
  "from-indigo-500/60 to-indigo-600/30",
];

export function ReportChannelsList({ channels }: Props) {
  if (channels.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/50 bg-secondary/10 p-10 text-center text-sm italic text-muted-foreground">
        Каналы не настроены или нет данных
      </div>
    );
  }

  const totalLeads = channels.reduce((s, c) => s + c.leads, 0);
  const top = channels[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/40 bg-card/40 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Всего заявок по каналам
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{reportFmt.fmtNum(totalLeads)}</div>
        </div>
        {top && (
          <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-success/80">
              Главный канал
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold">{top.name}</span>
              <span className="text-lg font-bold tabular-nums text-success">{top.share.toFixed(1)}%</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {reportFmt.fmtNum(top.leads)} заявок
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {channels.map((c, i) => (
          <div
            key={c.name}
            className="rounded-xl border border-border/40 bg-card/40 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary/50 text-muted-foreground">
                  <Radio className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {reportFmt.fmtNum(c.leads)} заявок
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-base font-bold tabular-nums">{c.share.toFixed(1)}%</div>
                <div className="text-[10px] text-muted-foreground">доля</div>
              </div>
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-secondary/30">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${CHANNEL_COLORS[i % CHANNEL_COLORS.length]}`}
                style={{ width: `${Math.max(c.share, c.leads > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
