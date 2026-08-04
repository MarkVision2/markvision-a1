import { useMemo, useState } from "react";
import {
  ChevronDown, Coins, FileText, Globe, Heart, Megaphone, MessageCircle,
  ShoppingBag, Target, TrendingDown, TrendingUp, Users, Video, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { classifyGoal, type GoalKey, type MetaCampaignRow } from "@/hooks/useMetaStructure";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtTengeCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M ₸`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k ₸`;
  return fmtTenge(n);
};

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
  crmSales: number;
  crmRevenue: number;
  crmLeads: number;
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

const GOAL_ACCENT: Record<GoalKey, string> = {
  leads_pixel: "text-primary bg-primary/10 border-primary/20",
  leads_form: "text-primary bg-primary/10 border-primary/20",
  leads: "text-primary bg-primary/10 border-primary/20",
  whatsapp: "text-success bg-success/10 border-success/20",
  messages: "text-success bg-success/10 border-success/20",
  engagement: "text-pink-500 bg-pink-500/10 border-pink-500/20",
  traffic: "text-warning bg-warning/10 border-warning/20",
  purchase: "text-success bg-success/10 border-success/20",
  video: "text-primary bg-primary/10 border-primary/20",
  awareness: "text-muted-foreground bg-muted border-border/60",
  other: "text-foreground bg-secondary border-border/60",
};

const successLabelOf = (m: GoalBucket["successMetric"]) =>
  m === "leads" ? "Заявки"
  : m === "messages" ? "Сообщения"
  : m === "purchases" ? "Покупки"
  : m === "clicks" ? "Клики"
  : "Показы";

interface Props {
  rows: MetaCampaignRow[];
  onOpenCreatives?: (campaignName?: string) => void;
}

export function CampaignGoalsBreakdown({ rows, onOpenCreatives }: Props) {
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
        crmSales: 0, crmRevenue: 0, crmLeads: 0,
      };
      cur.campaigns.push(r);
      cur.spend += r.spend;
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.leads += r.leads;
      cur.messages += r.messages;
      cur.purchases += r.purchases;
      cur.revenue += r.revenue;
      cur.crmSales += r.crmSales;
      cur.crmRevenue += r.crmRevenue;
      cur.crmLeads += r.crmLeads;
      map.set(goal.key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend || b.campaigns.length - a.campaigns.length);
  }, [rows]);

  if (goals.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        <Target className="mx-auto mb-2 h-5 w-5" />
        Кампании с целями появятся после синхронизации Meta за выбранный период.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {goals.map((g) => (
        <GoalCard key={g.key} goal={g} onOpenCreatives={onOpenCreatives} />
      ))}
    </div>
  );
}

function GoalCard({
  goal: g,
  onOpenCreatives,
}: {
  goal: GoalBucket;
  onOpenCreatives?: (campaignName?: string) => void;
}) {
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
  const hasCrm = g.crmRevenue > 0 && g.spend > 0;
  const crmRomi = hasCrm ? ((g.crmRevenue - g.spend) / g.spend) * 100 : 0;

  const sorted = [...g.campaigns].sort((a, b) => b.spend - a.spend);
  const visible = expanded ? sorted : sorted.slice(0, 4);
  const hasMore = sorted.length > 4;
  const activeCount = sorted.filter((c) => c.effectiveStatus === "ACTIVE").length;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/50">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl border", accent)}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">{g.label}</h3>
              <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                {g.campaigns.length}
              </span>
              {activeCount > 0 ? (
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", accent)}>
                  {activeCount} активн.
                </span>
              ) : (
                <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Нет активных
                </span>
              )}
            </div>
            {hasCrm ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Выручка CRM {fmtTengeCompact(g.crmRevenue)} · {fmtNum(g.crmSales)} продаж · ROMI{" "}
                <span className={cn("font-semibold", crmRomi >= 0 ? "text-success" : "text-destructive")}>
                  {crmRomi >= 0 ? "+" : ""}{Math.round(crmRomi)}%
                </span>
              </p>
            ) : g.spend > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Расход есть. ROMI появится после оплат в CRM по этим кампаниям.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          <Kpi label="Расход" value={g.spend > 0 ? fmtTenge(g.spend) : "—"} />
          <Kpi label={successLabelOf(g.successMetric)} value={fmtNum(successValue)} accent />
          <Kpi label="CPL / цена" value={costPerResult > 0 ? fmtTenge(costPerResult) : "—"} />
          <Kpi label="CTR" value={ctr > 0 ? `${ctr.toFixed(2)}%` : "—"} />
          <Kpi
            label="ROMI CRM"
            value={hasCrm ? `${crmRomi >= 0 ? "+" : ""}${Math.round(crmRomi)}%` : "—"}
            tone={hasCrm ? (crmRomi >= 0 ? "success" : "danger") : undefined}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      </div>

      {visible.length > 0 && (
        <div className="border-t border-border/50 px-4 py-3 sm:px-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Кампании · {sorted.length}
            </span>
            {hasMore && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                {expanded ? "Свернуть" : `Ещё ${sorted.length - 4}`}
                <ChevronDown className={cn("h-3.5 w-3.5 transition", expanded && "rotate-180")} />
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {visible.map((c) => (
              <CampaignRow
                key={c.id}
                campaign={c}
                successMetric={g.successMetric}
                onOpenCreatives={onOpenCreatives}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  tone,
  className,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "success" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-background/50 px-3 py-2.5",
        accent && "border-primary/25 bg-primary/5",
        tone === "success" && "border-success/30 bg-success/5",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
        className,
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 truncate text-base font-bold tabular-nums",
          accent && "text-primary",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CampaignRow({
  campaign: c,
  successMetric,
  onOpenCreatives,
}: {
  campaign: MetaCampaignRow;
  successMetric: GoalBucket["successMetric"];
  onOpenCreatives?: (campaignName?: string) => void;
}) {
  const success = successMetric === "leads" ? c.leads
    : successMetric === "messages" ? c.messages
    : successMetric === "purchases" ? c.purchases
    : successMetric === "clicks" ? c.clicks
    : c.impressions;
  const costPer = success > 0 ? c.spend / success : 0;
  const isActive = c.effectiveStatus === "ACTIVE";
  const hasCrm = c.crmRevenue > 0 && c.spend > 0;

  return (
    <li
      className={cn(
        "rounded-xl border px-3 py-2.5 transition",
        isActive ? "border-success/25 bg-success/[0.04]" : "border-border/50 bg-background/40",
        onOpenCreatives && "cursor-pointer hover:border-border",
      )}
      onClick={onOpenCreatives ? () => onOpenCreatives(c.name || c.campaignId) : undefined}
      onKeyDown={onOpenCreatives ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenCreatives(c.name || c.campaignId);
        }
      } : undefined}
      role={onOpenCreatives ? "button" : undefined}
      tabIndex={onOpenCreatives ? 0 : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", isActive ? "bg-success" : "bg-muted-foreground/30")} />
            <div className="truncate text-sm font-semibold" title={c.name || c.campaignId}>
              {c.name || c.campaignId}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-4 text-[11px] text-muted-foreground">
            <span>{fmtNum(c.impressions)} показов</span>
            <span>·</span>
            <span>CTR {c.ctr > 0 ? `${c.ctr.toFixed(2)}%` : "—"}</span>
            {onOpenCreatives && (
              <>
                <span>·</span>
                <span className="text-primary">креативы →</span>
              </>
            )}
          </div>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:min-w-[280px]">
          <MiniStat label="Расход" value={c.spend > 0 ? fmtTenge(c.spend) : "—"} />
          <MiniStat label={successLabelOf(successMetric)} value={fmtNum(success)} />
          <MiniStat label="Цена" value={costPer > 0 ? fmtTenge(costPer) : "—"} />
        </div>
      </div>
      {hasCrm && (
        <div className="mt-2 flex items-center gap-1.5 pl-4 text-[11px] font-semibold text-success">
          {c.crmRomi >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          ROMI CRM {c.crmRomi >= 0 ? "+" : ""}{Math.round(c.crmRomi)}%
          <span className="font-normal text-muted-foreground">
            · {fmtNum(c.crmSales)} × {fmtTengeCompact(c.crmRevenue)}
          </span>
          <Coins className="ml-auto h-3 w-3 text-muted-foreground sm:hidden" />
          <Wallet className="ml-auto hidden h-3 w-3 text-muted-foreground sm:block" />
        </div>
      )}
    </li>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-2 py-1.5 text-left">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate text-xs font-bold tabular-nums">{value}</div>
    </div>
  );
}
