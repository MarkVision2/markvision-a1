import { Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SiteBreakdownRow } from "@/lib/analyticsBreakdowns";

const fmtMoney = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function SitesTable({ rows }: { rows: SiteBreakdownRow[] }) {
  const visible = rows.filter((row) => row.leads > 0 || row.sales > 0);

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary/40 text-muted-foreground">
          <Globe2 className="h-5 w-5" />
        </span>
        <div className="text-sm text-muted-foreground">
          За период нет заявок с сайтов.
        </div>
      </div>
    );
  }

  const maxLeads = Math.max(...visible.map((row) => row.leads), 1);

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Сайт</th>
            <th className="px-4 py-3 text-right font-medium">Лиды</th>
            <th className="w-[28%] px-4 py-3 text-left font-medium">Доля</th>
            <th className="px-4 py-3 text-right font-medium">Продажи</th>
            <th className="px-4 py-3 text-right font-medium">Конверсия</th>
            <th className="px-4 py-3 text-right font-medium">Выручка</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.domain} className="border-t border-border/60">
              <td className="px-4 py-3 font-medium">{row.domain}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{fmtNum(row.leads)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary/40">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-success to-success/50"
                      style={{ width: `${(row.leads / maxLeads) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {row.share.toFixed(0)}%
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {row.sales > 0 ? fmtNum(row.sales) : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {row.leads > 0 && row.sales > 0 ? `${row.cr.toFixed(1)}%` : "—"}
              </td>
              <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", row.revenue > 0 && "text-success")}>
                {row.revenue > 0 ? fmtMoney(row.revenue) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
