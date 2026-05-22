import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UtmRow {
  source: string;
  campaign: string;
  medium: string;
  leads: number;
  sales: number;
  revenue: number;
  /** Среднее AI-score по лидам кампании (0–100). */
  avgScore?: number;
  /** Сколько лидов категории «горячий» (score≥75 или scheduled). */
  hotCount?: number;
  paidCount?: number;
}

const fmtMoney = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;
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
            <th className="px-4 py-3 text-right font-medium">Качество</th>
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
                <td className="px-4 py-3 text-right">
                  {r.avgScore !== undefined && r.avgScore > 0 ? (
                    <div className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                          r.avgScore >= 75 ? "bg-destructive/15 text-destructive" :
                          r.avgScore >= 50 ? "bg-warning/15 text-warning" :
                          "bg-muted text-muted-foreground",
                        )}
                      >
                        {Math.round(r.avgScore)}
                      </span>
                      {(r.hotCount ?? 0) > 0 && (
                        <span className="text-[10px] text-destructive">🔥{r.hotCount}</span>
                      )}
                      {(r.paidCount ?? 0) > 0 && (
                        <span className="text-[10px] text-success">💰{r.paidCount}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
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
