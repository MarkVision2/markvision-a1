import { AlertTriangle, Camera, Facebook, Megaphone, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

export type ChannelProvider = "meta" | "google" | "instagram_organic" | "crm";

interface ChannelRow {
  key: string;
  name: string;
  provider: ChannelProvider;
  spend: number;
  leads: number;
  sales: number;
  revenue: number;
}

interface Props {
  channels: ChannelRow[];
  totalSpend: number;
  totalLeads: number;
}

const PROVIDER_META: Record<ChannelProvider, { icon: typeof Camera; cls: string; bg: string }> = {
  meta: { icon: Facebook, cls: "text-primary", bg: "bg-primary/10" },
  google: { icon: Megaphone, cls: "text-warning", bg: "bg-warning/10" },
  instagram_organic: { icon: Camera, cls: "text-pink-500", bg: "bg-pink-500/10" },
  crm: { icon: Globe, cls: "text-muted-foreground", bg: "bg-muted/30" },
};

export function ChannelsTable({ channels, totalSpend, totalLeads }: Props) {
  if (channels.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        Пока нет данных по источникам. Подключите рекламный кабинет Meta/Google или добавьте код-слова Instagram, чтобы здесь появились заявки.
      </div>
    );
  }

  // У каждого канала может быть свой реальный spend (Meta / Google).
  // Если у CRM-канала spend нулевой, но у totals общий spend > 0, разносим
  // остаток пропорционально лидам — чтобы старые CRM-источники имели хотя бы оценку.
  const hasExplicitSpend = channels.some((c) => c.spend > 0);
  const explicitSpend = channels.reduce((s, c) => s + c.spend, 0);
  const unaccountedSpend = Math.max(0, totalSpend - explicitSpend);
  const leadsWithoutSpend = channels.filter((c) => c.spend === 0).reduce((s, c) => s + c.leads, 0);

  const enriched = channels.map((c) => {
    const spend = c.spend > 0
      ? c.spend
      : leadsWithoutSpend > 0 && unaccountedSpend > 0
        ? (c.leads / leadsWithoutSpend) * unaccountedSpend
        : 0;
    const cpl = c.leads > 0 ? spend / c.leads : 0;
    const romi = spend > 0
      ? ((c.revenue - spend) / spend) * 100
      : c.revenue > 0 ? 100 : 0;
    return { ...c, displaySpend: spend, cpl, romi };
  });
  enriched.sort((a, b) => b.romi - a.romi);

  // Note: каналы Instagram organic в spend не участвуют — у органики нет рекламного бюджета.
  const showSpendApprox = !hasExplicitSpend && totalSpend > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Источник</th>
              <th className="px-4 py-3 text-right font-semibold">
                Расход{showSpendApprox ? "*" : ""}
              </th>
              <th className="px-4 py-3 text-right font-semibold">Заявки</th>
              <th className="px-4 py-3 text-right font-semibold">Оплаты</th>
              <th className="px-4 py-3 text-right font-semibold">Цена заявки</th>
              <th className="px-4 py-3 text-right font-semibold">Окупаемость</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((c) => {
              const bad = c.displaySpend > 0 && c.romi < 0;
              const meta = PROVIDER_META[c.provider] ?? PROVIDER_META.crm;
              const Icon = meta.icon;
              return (
                <tr key={c.key} className="border-t border-border/30">
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-2.5">
                      <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg", meta.bg)}>
                        <Icon className={cn("h-3.5 w-3.5", meta.cls)} />
                      </span>
                      {bad && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                      {c.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {c.provider === "instagram_organic"
                      ? <span className="text-muted-foreground">органика</span>
                      : c.displaySpend > 0 ? fmtTenge(c.displaySpend) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(c.leads)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(c.sales)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.cpl > 0 ? fmtTenge(c.cpl) : "—"}</td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-bold tabular-nums",
                      c.romi >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {c.displaySpend > 0
                      ? `${c.romi >= 0 ? "+" : ""}${Math.round(c.romi)}%`
                      : c.revenue > 0 ? "органика" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showSpendApprox && (
        <div className="border-t border-border/30 bg-secondary/20 px-4 py-2 text-[10px] text-muted-foreground">
          * Расход распределён пропорционально доле заявок источника. Точный расход появится после привязки UTM к рекламным кабинетам Meta/Google.
        </div>
      )}
      {/* Скрытое использование totalLeads — оставлено в типе для совместимости. */}
      <span className="sr-only">{totalLeads}</span>
    </div>
  );
}
