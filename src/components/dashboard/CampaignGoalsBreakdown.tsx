import { useMemo, useState } from "react";
import { ChevronDown, FileText, Globe, Heart, Megaphone, MessageCircle, ShoppingBag, Target, TrendingDown, TrendingUp, Users, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { classifyGoal, type GoalKey, type MetaCampaignRow } from "@/hooks/useMetaStructure";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const splitTenge = (n: number) => ({ amount: Math.round(n).toLocaleString("ru-RU"), unit: "₸" });

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

const GOAL_ACCENT: Record<GoalKey, { icon: string; ring: string; dot: string }> = {
  leads_pixel: { icon: "bg-primary/10 text-primary border-primary/20", ring: "shadow-primary/30", dot: "bg-primary" },
  leads_form:  { icon: "bg-primary/10 text-primary border-primary/20", ring: "shadow-primary/30", dot: "bg-primary" },
  leads:       { icon: "bg-primary/10 text-primary border-primary/20", ring: "shadow-primary/30", dot: "bg-primary" },
  whatsapp:    { icon: "bg-success/10 text-success border-success/20", ring: "shadow-success/30", dot: "bg-success" },
  messages:    { icon: "bg-success/10 text-success border-success/20", ring: "shadow-success/30", dot: "bg-success" },
  engagement:  { icon: "bg-pink-500/10 text-pink-500 border-pink-500/20", ring: "shadow-pink-500/30", dot: "bg-pink-500" },
  traffic:     { icon: "bg-warning/10 text-warning border-warning/20", ring: "shadow-warning/30", dot: "bg-warning" },
  purchase:    { icon: "bg-success/10 text-success border-success/20", ring: "shadow-success/30", dot: "bg-success" },
  video:       { icon: "bg-primary/10 text-primary border-primary/20", ring: "shadow-primary/30", dot: "bg-primary" },
  awareness:   { icon: "bg-muted text-muted-foreground border-border/60", ring: "shadow-muted/30", dot: "bg-muted-foreground/40" },
  other:       { icon: "bg-secondary text-foreground border-border/60", ring: "shadow-muted/30", dot: "bg-muted-foreground/40" },
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
    <div className="space-y-4">
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
  const activeCount = sorted.filter((c) => c.effectiveStatus === "ACTIVE").length;
  const isInactive = activeCount === 0 && g.spend === 0;

  const spendParts = g.spend > 0 ? splitTenge(g.spend) : null;
  const costParts = costPerResult > 0 ? splitTenge(costPerResult) : null;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card/85 via-card/55 to-card/25 backdrop-blur-md transition-all hover:border-border hover:shadow-[0_24px_70px_-24px_hsl(var(--background))]",
        isInactive && "opacity-50",
      )}
    >
      {/* left accent stripe */}
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-[3px]",
          activeCount > 0 ? accent.dot : "bg-border/50",
        )}
        aria-hidden
      />
      {/* corner glow */}
      {activeCount > 0 && (
        <span
          className={cn(
            "pointer-events-none absolute -left-24 -top-24 h-56 w-56 rounded-full opacity-[0.10] blur-3xl",
            accent.dot,
          )}
          aria-hidden
        />
      )}

      {/* HEADER */}
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-5 px-5 py-5 pl-6 sm:px-6 sm:pl-7">
        {/* Title block */}
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span
            className={cn(
              "grid h-14 w-14 shrink-0 place-items-center rounded-2xl border transition-all",
              accent.icon,
              activeCount > 0 && "shadow-[0_8px_28px_-8px] " + accent.ring,
            )}
          >
            <Icon className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[18px] font-semibold leading-tight tracking-[-0.015em] text-foreground">
                {g.label}
              </h3>
              <span className="inline-flex items-center rounded-md border border-border/50 bg-secondary/50 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                {g.campaigns.length}
              </span>
              {activeCount > 0 ? (
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", accent.icon)}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className={cn("absolute inset-0 animate-ping rounded-full opacity-70", accent.dot)} />
                    <span className={cn("relative h-1.5 w-1.5 rounded-full", accent.dot)} />
                  </span>
                  {activeCount} активных
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                  Нет активных
                </span>
              )}
            </div>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid w-full grid-cols-5 gap-2 sm:w-auto sm:gap-2.5">
          <KpiCell label="Расход" amount={spendParts?.amount ?? "—"} unit={spendParts?.unit} />
          <KpiCell label={successLabelOf(g.successMetric)} amount={fmtNum(successValue)} highlight />
          <KpiCell label="Цена рез." amount={costParts?.amount ?? "—"} unit={costParts?.unit} />
          <KpiCell label="CTR" amount={ctr > 0 ? `${ctr.toFixed(2)}%` : "—"} />
          <KpiCell
            label="ROMI"
            amount={g.spend > 0 ? `${romi >= 0 ? "+" : ""}${Math.round(romi)}%` : "—"}
            tone={g.spend === 0 ? undefined : romi >= 0 ? "success" : "destructive"}
          />
        </div>
      </div>

      {/* CAMPAIGNS */}
      {visible.length > 0 && (
        <div className="relative border-t border-border/40 bg-background/40 px-3 pb-3 pt-3 pl-6 sm:px-4 sm:pl-7">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
              <span className="h-px w-5 bg-border" />
              Кампании · по расходу
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
              >
                {expanded ? "Свернуть" : `Ещё ${sorted.length - 3}`}
                <ChevronDown className={cn("h-3 w-3 transition", expanded && "rotate-180")} />
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {visible.map((c) => (
              <CampaignRow key={c.id} campaign={c} maxSpend={maxSpend} successMetric={g.successMetric} dotClass={accent.dot} ringClass={accent.ring} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KpiCell({
  label,
  amount,
  unit,
  tone,
  highlight,
}: {
  label: string;
  amount: string;
  unit?: string;
  tone?: "success" | "destructive";
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[78px] flex-col items-start gap-1.5 rounded-xl border border-border/40 bg-background/40 px-3 py-2 backdrop-blur-sm transition-colors",
        highlight && "border-primary/25 bg-primary/[0.06]",
        tone === "destructive" && "border-destructive/25 bg-destructive/[0.05]",
        tone === "success" && "border-success/25 bg-success/[0.05]",
      )}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">{label}</div>
      <div
        className={cn(
          "text-[17px] font-bold tabular-nums leading-none tracking-[-0.02em] text-foreground",
          highlight && "text-primary",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
        )}
      >
        {amount}
        {unit && <span className="ml-0.5 text-[12px] font-medium opacity-70">{unit}</span>}
      </div>
    </div>
  );
}

function CampaignRow({
  campaign: c,
  maxSpend,
  successMetric,
  dotClass,
  ringClass,
}: {
  campaign: MetaCampaignRow;
  maxSpend: number;
  successMetric: GoalBucket["successMetric"];
  dotClass: string;
  ringClass: string;
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
    <li
      className={cn(
        "group/row relative overflow-hidden rounded-xl border px-3 py-2.5 transition-all",
        isActive
          ? "border-success/15 bg-success/[0.04] hover:border-success/25 hover:bg-success/[0.07]"
          : "border-border/40 bg-card/30 hover:border-border/70 hover:bg-card/60",
      )}
    >
      {/* bg progress bar (share of spend) */}
      <span
        className={cn("pointer-events-none absolute inset-y-0 left-0 opacity-[0.05] transition group-hover/row:opacity-[0.10]", dotClass)}
        style={{ width: `${sharePct}%` }}
        aria-hidden
      />
      <div className="relative flex items-center gap-3">
        {/* status dot */}
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isActive ? cn(dotClass, "shadow-[0_0_8px] " + ringClass) : "bg-muted-foreground/25",
          )}
          title={isActive ? "Активна" : c.effectiveStatus ?? "Неактивна"}
        />
        {/* name */}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-[13px] font-medium leading-tight tracking-tight transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground group-hover/row:text-foreground",
            )}
            title={c.name || c.campaignId}
          >
            {c.name || c.campaignId}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground/80">
            <span className="tabular-nums">{fmtNum(c.impressions)} показов</span>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span className="tabular-nums">CTR <span className="text-foreground/80">{c.ctr > 0 ? `${c.ctr.toFixed(2)}%` : "—"}</span></span>
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
        "inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-background/70 px-2 py-1 text-[10.5px] backdrop-blur-sm transition-colors",
        accent === "primary" && "border-primary/25 bg-primary/[0.07]",
        accent === "success" && "border-success/25 bg-success/[0.07]",
        accent === "destructive" && "border-destructive/25 bg-destructive/[0.07]",
      )}
    >
      <span className="font-bold uppercase tracking-wider text-muted-foreground/70 text-[9px]">{label}</span>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-semibold tabular-nums text-foreground",
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
