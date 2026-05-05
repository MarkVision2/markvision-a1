import { Inbox } from "lucide-react";

export interface UtmRow {
  source: string;
  campaign: string;
  medium: string;
  leads: number;
  sales: number;
  revenue: number;
}

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("ru-RU")}`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export const UtmTable = ({ rows }: { rows: UtmRow[] }) => {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary/40 text-muted-foreground">
          <Inbox className="h-5 w-5" />
        </span>
        <div className="text-sm text-muted-foreground">
          Лиды без UTM-меток. Добавьте utm_source / utm_campaign к ссылкам в кампаниях.
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <table className="w-full text-sm">
        <thead className="bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">utm_source</th>
            <th className="px-4 py-3 text-left font-medium">utm_campaign</th>
            <th className="px-4 py-3 text-left font-medium">utm_medium</th>
            <th className="px-4 py-3 text-right font-medium">Лиды</th>
            <th className="px-4 py-3 text-right font-medium">Продажи</th>
            <th className="px-4 py-3 text-right font-medium">Выручка</th>
            <th className="px-4 py-3 text-right font-medium">Конв.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const conv = r.leads > 0 ? (r.sales / r.leads) * 100 : 0;
            return (
              <tr key={i} className="border-t border-border/60 last:border-b-0">
                <td className="px-4 py-3 font-medium">{r.source || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.campaign || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.medium || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtNum(r.leads)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.sales > 0 ? fmtNum(r.sales) : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-success">
                  {r.revenue > 0 ? fmtMoney(r.revenue) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.leads > 0 ? `${conv.toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
