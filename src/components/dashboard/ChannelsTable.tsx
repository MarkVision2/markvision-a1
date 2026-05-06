import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

interface ChannelRow {
  name: string;
  leads: number;
  sales: number;
  revenue: number;
}

interface Props {
  channels: ChannelRow[];
  totalSpend: number;
  totalLeads: number;
}

export function ChannelsTable({ channels, totalSpend, totalLeads }: Props) {
  if (channels.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        Нет данных по каналам. Добавьте лидов в CRM с указанием источника.
      </div>
    );
  }

  const enriched = channels.map((c) => {
    const spendShare = totalLeads > 0 ? (c.leads / totalLeads) * totalSpend : 0;
    const cpl = c.leads > 0 ? spendShare / c.leads : 0;
    const romi = spendShare > 0 ? ((c.revenue - spendShare) / spendShare) * 100 : c.revenue > 0 ? 100 : 0;
    return { ...c, spend: spendShare, cpl, romi };
  });
  enriched.sort((a, b) => b.romi - a.romi);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Канал</th>
              <th className="px-4 py-3 text-right font-semibold">Расход*</th>
              <th className="px-4 py-3 text-right font-semibold">Лиды</th>
              <th className="px-4 py-3 text-right font-semibold">Продажи</th>
              <th className="px-4 py-3 text-right font-semibold">CPL</th>
              <th className="px-4 py-3 text-right font-semibold">ROMI</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((c) => {
              const bad = c.romi < 0;
              return (
                <tr key={c.name} className="border-t border-border/30">
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-2">
                      {bad && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                      {c.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.spend > 0 ? fmtTenge(c.spend) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(c.leads)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(c.sales)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.cpl > 0 ? fmtTenge(c.cpl) : "—"}</td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-bold tabular-nums",
                      c.romi >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {c.spend > 0 ? `${c.romi >= 0 ? "+" : ""}${Math.round(c.romi)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/30 bg-secondary/20 px-4 py-2 text-[10px] text-muted-foreground">
        * Расход распределён пропорционально доле лидов канала. Точный расход появится после привязки UTM к рекламным кабинетам.
      </div>
    </div>
  );
}