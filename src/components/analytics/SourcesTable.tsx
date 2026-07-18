import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceBreakdownRow } from "@/lib/analyticsBreakdowns";

const fmtMoney = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function SourcesTable({ rows }: { rows: SourceBreakdownRow[] }) {
  const visible = rows.filter((r) => r.leads > 0 || r.sales > 0);

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary/40 text-muted-foreground">
          <Inbox className="h-5 w-5" />
        </span>
        <div className="text-sm text-muted-foreground">
          За период нет лидов в CRM — источники появятся вместе с заявками.
        </div>
      </div>
    );
  }

  const maxLeads = Math.max(...visible.map((r) => r.leads), 1);

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Источник</th>
            <th className="px-4 py-3 text-right font-medium">Лиды</th>
            <th className="w-[26%] px-4 py-3 text-left font-medium">Доля</th>
            <th className="px-4 py-3 text-right font-medium">Горячие</th>
            <th className="px-4 py-3 text-right font-medium">Продажи</th>
            <th className="px-4 py-3 text-right font-medium">Выручка</th>
            <th className="px-4 py-3 text-right font-medium">Конв.</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.key} className="border-t border-border/60">
              <td className="px-4 py-3 font-medium">{r.label}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{fmtNum(r.leads)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary/40">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-primary/50"
                      style={{ width: `${(r.leads / maxLeads) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {r.share.toFixed(0)}%
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.hot > 0 ? <span className="text-destructive">🔥 {fmtNum(r.hot)}</span> : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{r.sales > 0 ? fmtNum(r.sales) : "—"}</td>
              <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", r.revenue > 0 && "text-success")}>
                {r.revenue > 0 ? fmtMoney(r.revenue) : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.leads > 0 && r.sales > 0 ? `${r.cr.toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
