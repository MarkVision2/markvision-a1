import { Users, TimerReset, TrendingUp, Wallet, Award, UserPlus2, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ManagerStats } from "@/hooks/useCrmAnalytics";

interface Props {
  stats: ManagerStats[];
  onAddManager?: () => void;
}

export function ManagersView({ stats, onAddManager }: Props) {
  if (stats.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/40 p-10 text-center">
        <Users className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <div className="mt-3 text-base font-semibold">Нет CRM-менеджеров</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Добавьте менеджера в текущий проект — после этого его можно будет выбрать ответственным в карточке лида.
        </p>
        <Button className="mt-5 gap-2" onClick={onAddManager}>
          <UserPlus2 className="h-4 w-4" />
          Добавить CRM-менеджера
        </Button>
      </div>
    );
  }

  const sorted = [...stats].sort((a, b) => b.revenue - a.revenue);
  const maxRevenue = Math.max(1, ...sorted.map((s) => s.revenue));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/25">
            <Users className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">CRM-менеджеры</h2>
            <p className="text-xs text-muted-foreground">
              Добавляйте менеджеров текущего проекта и назначайте ответственного в карточке лида через поле «Ответственный».
            </p>
          </div>
        </div>
        <Button className="gap-2" onClick={onAddManager}>
          <UserPlus2 className="h-4 w-4" />
          Добавить CRM-менеджера
        </Button>
      </div>

      <div className="rounded-2xl border border-success/25 bg-success/5 px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          <MousePointerClick className="h-3.5 w-3.5 text-success" />
          Где выбрать ответственного:
        </span>{" "}
        откройте лид в CRM, сверху рядом с этапом нажмите на плашку «Ответственный» и выберите менеджера.
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-2 sm:p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">Менеджер</th>
              <th className="px-3 py-2 text-right">Лидов</th>
              <th className="px-3 py-2 text-right">SLA &lt;5мин</th>
              <th className="px-3 py-2 text-right">Конверсия</th>
              <th className="px-3 py-2 text-right">Оплат</th>
              <th className="px-3 py-2 text-right">Выручка</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, idx) => {
              const slaPct = s.respondedTotal > 0 ? (s.responsesUnder5 / s.respondedTotal) * 100 : 0;
              const slaCol = slaPct >= 70 ? "text-success" : slaPct >= 40 ? "text-warning" : "text-destructive";
              const convCol = s.conversion >= 30 ? "text-success" : s.conversion >= 15 ? "text-warning" : "text-muted-foreground";
              const revShare = s.revenue / maxRevenue;
              return (
                <tr key={s.member.id} className="border-t border-border/40 hover:bg-secondary/20">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {idx === 0 && s.revenue > 0 && <Award className="h-4 w-4 text-warning" />}
                      <div>
                        <div className="font-semibold">{s.member.name}</div>
                        <div className="text-[11px] text-muted-foreground">{s.member.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{s.assigned}</td>
                  <td className={cn("px-3 py-3 text-right tabular-nums font-semibold", slaCol)}>
                    <span className="inline-flex items-center gap-1">
                      <TimerReset className="h-3 w-3" />
                      {slaPct.toFixed(0)}%
                    </span>
                  </td>
                  <td className={cn("px-3 py-3 text-right tabular-nums font-semibold", convCol)}>
                    <span className="inline-flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {s.conversion.toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{s.paid}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 font-bold tabular-nums">
                        <Wallet className="h-3 w-3 text-success" />
                        {s.revenue.toLocaleString("ru-RU")} $
                      </span>
                      <div className="h-1 w-24 overflow-hidden rounded-full bg-secondary/60">
                        <div className="h-full bg-success" style={{ width: `${revShare * 100}%` }} />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
