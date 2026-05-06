import { cn } from "@/lib/utils";
import type { ChannelMeta } from "@/lib/channelAttribution";

export interface ChannelStat {
  meta: ChannelMeta;
  spend: number;
  leads: number;
  sales: number;
  revenue: number;
}

const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export const ChannelCard = ({ stat }: { stat: ChannelStat }) => {
  const { meta, spend, leads, sales, revenue } = stat;
  const cpl = leads > 0 && spend > 0 ? spend / leads : 0;
  const romi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
  const Icon = meta.Icon;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn("grid h-9 w-9 place-items-center rounded-xl", meta.bg, meta.color)}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="text-sm font-semibold">{meta.label}</div>
        </div>
        {romi !== null && (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
              romi >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
            )}
          >
            ROMI {romi >= 0 ? "+" : ""}
            {Math.round(romi)}%
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <Cell label="Расход" value={spend > 0 ? fmtMoney(spend) : "—"} />
        <Cell label="Лиды" value={leads > 0 ? fmtNum(leads) : "—"} />
        <Cell label="CPL" value={cpl > 0 ? fmtMoney(cpl) : "—"} />
        <Cell label="Продажи" value={sales > 0 ? fmtNum(sales) : "—"} />
        <Cell label="Выручка" value={revenue > 0 ? fmtMoney(revenue) : "—"} accent />
        <Cell
          label="Конверсия"
          value={leads > 0 ? `${((sales / leads) * 100).toFixed(1)}%` : "—"}
        />
      </div>
    </div>
  );
};

const Cell = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={cn("mt-0.5 font-bold tabular-nums", accent && "text-success")}>{value}</div>
  </div>
);
