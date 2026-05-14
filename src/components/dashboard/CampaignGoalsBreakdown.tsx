import { useMemo, useState } from "react";
import { ChevronDown, FileText, Globe, Heart, Megaphone, MessageCircle, ShoppingBag, Target, TrendingDown, TrendingUp, Users, Video } from "lucide-react";
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
  messages: MessageCircle,
  engagement: Heart,
  traffic: Globe,
  purchase: ShoppingBag,
  video: Video,
  awareness: Megaphone,
  other: Target,
};

/** Цветовая палитра для левого акцента + иконки. */
const GOAL_ACCENT: Record<GoalKey, { stripe: string; icon: string; soft: string }> = {
  leads_pixel: { stripe: "bg-primary", icon: "bg-primary/15 text-primary", soft: "from-primary/8" },
  leads_form: { stripe: "bg-primary", icon: "bg-primary/15 text-primary", soft: "from-primary/8" },
  leads: { stripe: "bg-primary", icon: "bg-primary/15 text-primary", soft: "from-primary/8" },
  whatsapp: { stripe: "bg-success", icon: "bg-success/15 text-success", soft: "from-success/8" },
  messages: { stripe: "bg-success", icon: "bg-success/15 text-success", soft: "from-success/8" },
  engagement: { stripe: "bg-pink-500", icon: "bg-pink-500/15 text-pink-500", soft: "from-pink-500/8" },
  traffic: { stripe: "bg-warning", icon: "bg-warning/15 text-warning", soft: "from-warning/8" },
  purchase: { stripe: "bg-success", icon: "bg-success/15 text-success", soft: "from-success/8" },
  video: { stripe: "bg-primary", icon: "bg-primary/15 text-primary", soft: "from-primary/8" },
  awareness: { stripe: "bg-muted-foreground/40", icon: "bg-muted text-muted-foreground", soft: "from-muted/30" },
  other: { stripe: "bg-secondary", icon: "bg-secondary text-foreground", soft: "from-secondary/30" },
};

const successLabelOf = (m: GoalBucket["successMetric"]) =>
  m === "leads" ? "Заявок"
  : m === "messages" ? "Сообщ."
  : m === "purchases" ? "Покупок"
  : m === "clicks" ? "Кликов"
  : "Показов";

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
      {goals.map((g) => (
        <GoalCard key={g.key} goal={g} />
      ))}
    </div>
  );
}

function GoalCard({ goal: g }: { goal: GoalBucket }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = GOAL_ICONS[g.key];
  const accent = GOAL_ACCENT[g.key];

  const successValue = g.successMetric === "leads" ? g.leads
    : g.successMetric === "messages" ? g.messages
    : g.successMetric === "purchases" ? g.purchases
    : g.successMetric === "clicks" ? g.clicks
    : g.impressions;
  const costPerResult = successValue > 0 ? g.spend / successValue : 0;
  const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
  const romi = g.spend > 0 ? ((g.revenue - g.spend) / g.spend) * 100 : 0;

  const sorted = [...g.campaigns].sort((a, b) => b.spend - a.spend);
  const visible = expanded ? sorted : sorted.slice(0, 3);
  const hasMore = sorted.length > 3;
  const maxSpend = sorted[0]?.spend || 1;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 transition hover:border-border">
      {/* left accent stripe */}
      <span className={cn("absolute inset-y-0 left-0 w-1", accent.stripe)} aria-hidden />
      {/* subtle gradient wash */}
      <span className={cn("pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent opacity-60", accent.soft)} aria-hidden />

      {/* HEADER */}
      <div className="relative flex flex-wrap items-center gap-4 px-4 py-3.5 pl-5 sm:px-5 sm:pl-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", accent.icon)}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-bold leading-tight">{g.label}</h3>
              <span className="rounded-full border border-border/60 bg-card px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                {g.campaigns.length}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {sorted.filter((c) => c.effectiveStatus === "ACTIVE").length} активных
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div className="flex flex-wrap items-stretch gap-x-5 gap-y-1 text-right">
          <KpiCell label="Расход" value={g.spend > 0 ? fmtTenge(g.spend) : "—"} />
          <KpiCell label={successLabelOf(g.successMetric)} value={fmtNum(successValue)} />
          <KpiCell label="Цена рез." value={costPerResult > 0 ? fmtTenge(costPerResult) : "—"} />
          <KpiCell label="CTR" value={ctr > 0 ? `${ctr.toFixed(2)}%` : "—"} />
          <KpiCell
            label="ROMI"
            value={g.spend > 0 ? `${romi >= 0 ? "+" : ""}${Math.round(romi)}%` : "—"}
            tone={g.spend === 0 ? undefined : romi >= 0 ? "success" : "destructive"}
          />
        </div>
      </div>

      {/* CAMPAIGNS */}
      {visible.length > 0 && (
        <div className="relative border-t border-border/40 bg-background/30 px-3 py-2.5 pl-5 sm:pl-6">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Кампании · по расходу
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-secondary/50 hover:text-foreground"
              >
                {expanded ? "Свернуть" : `Ещё ${sorted.length - 3}`}
                <ChevronDown className={cn("h-3 w-3 transition", expanded && "rotate-180")} />
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {visible.map((c) => (
              <CampaignRow key={c.id} campaign={c} maxSpend={maxSpend} successMetric={g.successMetric} stripeClass={accent.stripe} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KpiCell({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" }) {
  return (
    <div className="min-w-[68px]">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{label}</div>
      <div
        className={cn(
          "text-[15px] font-bold tabular-nums leading-tight",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CampaignRow({
  campaign: c,
  maxSpend,
  successMetric,
  stripeClass,
}: {
  campaign: MetaCampaignRow;
  maxSpend: number;
  successMetric: GoalBucket["successMetric"];
  stripeClass: string;
}) {
  const success = successMetric === "leads" ? c.leads
    : successMetric === "messages" ? c.messages
    : successMetric === "purchases" ? c.purchases
    : successMetric === "clicks" ? c.clicks
    : c.impressions;
  const costPer = success > 0 ? c.spend / success : 0;
  const isActive = c.effectiveStatus === "ACTIVE";
  const sharePct = Math.max(2, Math.round((c.spend / maxSpend) * 100));
  const romi = c.spend > 0 ? ((c.revenue - c.spend) / c.spend) * 100 : 0;
  const hasRomi = c.revenue > 0 && c.spend > 0;

  return (
    <li className="group/row relative overflow-hidden rounded-lg border border-transparent bg-card/40 px-2.5 py-2 transition hover:border-border/60 hover:bg-card/80">
      {/* bg progress bar (share of spend) */}
      <span
        className={cn("pointer-events-none absolute inset-y-0 left-0 opacity-[0.07] transition group-hover/row:opacity-[0.14]", stripeClass)}
        style={{ width: `${sharePct}%` }}
        aria-hidden
      />
      <div className="relative flex items-center gap-3">
        {/* status dot */}
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isActive ? "bg-success shadow-[0_0_0_3px] shadow-success/20" : "bg-muted-foreground/30",
          )}
          title={isActive ? "Активна" : c.effectiveStatus ?? "Неактивна"}
        />
        {/* name */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight" title={c.name || c.campaignId}>
            {c.name || c.campaignId}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
            <span className="tabular-nums">{fmtNum(c.impressions)} показов</span>
            <span className="text-border">·</span>
            <span className="tabular-nums">CTR {c.ctr > 0 ? `${c.ctr.toFixed(2)}%` : "—"}</span>
          </div>
        </div>
        {/* metric chips */}
        <div className="hidden items-center gap-1.5 sm:flex">
          <Chip label="Расход" value={c.spend > 0 ? fmtTenge(c.spend) : "—"} />
          <Chip label={successLabelOf(successMetric)} value={fmtNum(success)} accent="primary" />
          <Chip label="Цена" value={costPer > 0 ? fmtTenge(costPer) : "—"} />
          {hasRomi && (
            <Chip
              label="ROMI"
              value={`${romi >= 0 ? "+" : ""}${Math.round(romi)}%`}
              accent={romi >= 0 ? "success" : "destructive"}
              icon={romi >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            />
          )}
        </div>
        {/* mobile compact value */}
        <div className="sm:hidden text-right">
          <div className="text-xs font-bold tabular-nums">{c.spend > 0 ? fmtTenge(c.spend) : "—"}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {fmtNum(success)} · {costPer > 0 ? fmtTenge(costPer) : "—"}
          </div>
        </div>
      </div>
    </li>
  );
}

function Chip({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: "primary" | "success" | "destructive";
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/60 px-1.5 py-0.5 text-[10.5px]",
        accent === "primary" && "border-primary/30 bg-primary/5",
        accent === "success" && "border-success/30 bg-success/5",
        accent === "destructive" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <span className="font-semibold uppercase tracking-wider text-muted-foreground/80 text-[9px]">{label}</span>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-bold tabular-nums",
          accent === "primary" && "text-primary",
          accent === "success" && "text-success",
          accent === "destructive" && "text-destructive",
        )}
      >
        {icon}
        {value}
      </span>
    </div>
  );
}
