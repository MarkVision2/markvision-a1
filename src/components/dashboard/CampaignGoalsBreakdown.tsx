import { useMemo } from "react";
import { FileText, Globe, Heart, Megaphone, MessageCircle, ShoppingBag, Target, Users, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { classifyGoal, type GoalKey, type MetaCampaignRow } from "@/hooks/useMetaStructure";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

interface GoalBucket {
  key: GoalKey;
  label: string;
  successMetric: "leads" | "messages" | "purchases" | "clicks" | "impressions";
  campaigns: MetaCampaignRow[];
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  purchases: number;
  revenue: number;
}

const GOAL_ICONS: Record<GoalKey, typeof Target> = {
  leads_pixel: Globe,
  leads_form: FileText,
  leads: Users,
  whatsapp: MessageCircle,
  messages_multi: MessageCircle,
  messages: MessageCircle,
  engagement: Heart,
  traffic: Globe,
  purchase: ShoppingBag,
  video: Video,
  awareness: Megaphone,
  other: Target,
};

const GOAL_TONE: Record<GoalKey, string> = {
  leads_pixel: "bg-primary/15 text-primary",
  leads_form: "bg-primary/15 text-primary",
  leads: "bg-primary/15 text-primary",
  whatsapp: "bg-success/15 text-success",
  messages_multi: "bg-success/15 text-success",
  messages: "bg-success/15 text-success",
  engagement: "bg-pink-500/15 text-pink-500",
  traffic: "bg-warning/15 text-warning",
  purchase: "bg-success/15 text-success",
  video: "bg-primary/15 text-primary",
  awareness: "bg-muted text-muted-foreground",
  other: "bg-secondary text-foreground",
};

interface Props {
  rows: MetaCampaignRow[];
}

export function CampaignGoalsBreakdown({ rows }: Props) {
  const goals = useMemo<GoalBucket[]>(() => {
    const map = new Map<GoalKey, GoalBucket>();
    for (const r of rows) {
      const goal = classifyGoal(r.objective, r.destinationType);
      const cur = map.get(goal.key) ?? {
        key: goal.key,
        label: goal.label,
        successMetric: goal.successMetric,
        campaigns: [] as MetaCampaignRow[],
        spend: 0, impressions: 0, clicks: 0, leads: 0, messages: 0, purchases: 0, revenue: 0,
      };
      cur.campaigns.push(r);
      cur.spend += r.spend;
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.leads += r.leads;
      cur.messages += r.messages;
      cur.purchases += r.purchases;
      cur.revenue += r.revenue;
      map.set(goal.key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [rows]);

  if (goals.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        <Target className="mx-auto mb-2 h-5 w-5" />
        Кампании с целями появятся после первого запуска <code className="rounded bg-secondary px-1 text-[11px]">meta-structure-sync</code>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {goals.map((g) => {
        const Icon = GOAL_ICONS[g.key];
        const tone = GOAL_TONE[g.key];

        // Какую метрику считаем «результатом» для этой цели.
        const successValue = (() => {
          switch (g.successMetric) {
            case "leads": return g.leads;
            case "messages": return g.messages;
            case "purchases": return g.purchases;
            case "clicks": return g.clicks;
            case "impressions": return g.impressions;
          }
        })();
        const successLabel = (() => {
          switch (g.successMetric) {
            case "leads": return "заявок";
            case "messages": return "сообщений";
            case "purchases": return "покупок";
            case "clicks": return "кликов";
            case "impressions": return "показов";
          }
        })();
        const costPerResult = successValue > 0 ? g.spend / successValue : 0;
        const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
        const romi = g.spend > 0 ? ((g.revenue - g.spend) / g.spend) * 100 : 0;

        const topThree = [...g.campaigns]
          .sort((a, b) => b.spend - a.spend)
          .slice(0, 3);

        return (
          <div key={g.key} className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className={cn("grid h-10 w-10 place-items-center rounded-xl", tone)}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-bold">{g.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {g.campaigns.length} кампан{g.campaigns.length === 1 ? "ия" : "ий"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right sm:grid-cols-5">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Расход</div>
                  <div className="text-sm font-bold tabular-nums">{g.spend > 0 ? fmtTenge(g.spend) : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{successLabel}</div>
                  <div className="text-sm font-bold tabular-nums">{fmtNum(successValue)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Цена результата</div>
                  <div className="text-sm font-bold tabular-nums">{costPerResult > 0 ? fmtTenge(costPerResult) : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CTR</div>
                  <div className="text-sm font-bold tabular-nums">{ctr > 0 ? `${ctr.toFixed(2)}%` : "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ROMI</div>
                  <div className={cn(
                    "text-sm font-bold tabular-nums",
                    g.spend === 0 ? "" : romi >= 0 ? "text-success" : "text-destructive",
                  )}>
                    {g.spend > 0 ? `${romi >= 0 ? "+" : ""}${Math.round(romi)}%` : "—"}
                  </div>
                </div>
              </div>
            </div>

            {topThree.length > 0 && (
              <div className="border-t border-border/30 bg-secondary/10 px-4 py-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Топ кампании по расходу
                </div>
                <div className="space-y-1.5">
                  {topThree.map((c) => {
                    const cCpl = c.spend > 0 && c.leads > 0 ? c.spend / c.leads : 0;
                    return (
                      <div key={c.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-xs">
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              c.effectiveStatus === "ACTIVE" ? "bg-success" : "bg-muted-foreground/40",
                            )}
                          />
                          <span className="truncate" title={c.name}>{c.name || c.campaignId}</span>
                        </div>
                        <span className="tabular-nums text-muted-foreground">
                          {c.spend > 0 ? fmtTenge(c.spend) : "—"}
                        </span>
                        <span className="tabular-nums">{fmtNum(c.leads)} зая.</span>
                        <span className="tabular-nums text-muted-foreground">
                          {cCpl > 0 ? `CPL ${fmtTenge(cCpl)}` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
