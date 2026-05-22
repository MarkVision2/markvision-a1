import { AlertTriangle, Camera, Globe, MessageCircle, Music2, Search, TrendingDown, TrendingUp, Wallet, Users, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

export type ChannelProvider = "whatsapp" | "site" | "instagram" | "google" | "tiktok";

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

const PROVIDER_META: Record<ChannelProvider, { icon: typeof Camera; cls: string; bg: string; ring: string; label: string }> = {
  whatsapp: { icon: MessageCircle, cls: "text-success", bg: "bg-success/10", ring: "ring-success/20", label: "WhatsApp" },
  site: { icon: Globe, cls: "text-primary", bg: "bg-primary/10", ring: "ring-primary/20", label: "Сайт / лендинг" },
  instagram: { icon: Camera, cls: "text-pink-500", bg: "bg-pink-500/10", ring: "ring-pink-500/20", label: "Instagram" },
  google: { icon: Search, cls: "text-warning", bg: "bg-warning/10", ring: "ring-warning/20", label: "Google Ads" },
  tiktok: { icon: Music2, cls: "text-foreground", bg: "bg-secondary/60", ring: "ring-border/40", label: "TikTok Ads" },
};

export function ChannelsTable({ channels, totalSpend, totalLeads }: Props) {
  if (channels.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        Пока нет данных по источникам. Подключите рекламный кабинет Meta/Google или добавьте код-слова Instagram, чтобы здесь появились заявки.
      </div>
    );
  }

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
    const leadsShare = totalLeads > 0 ? (c.leads / totalLeads) * 100 : 0;
    return { ...c, displaySpend: spend, cpl, romi, leadsShare };
  });
  enriched.sort((a, b) => b.romi - a.romi);

  const showSpendApprox = !hasExplicitSpend && totalSpend > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {enriched.map((c) => {
          const meta = PROVIDER_META[c.provider] ?? PROVIDER_META.site;
          const Icon = meta.icon;
          // Только Instagram-канал может быть полностью органическим (нет CDI-расхода).
          const isOrganic = c.provider === "instagram" && c.spend === 0;
          const romiPositive = c.romi >= 0;
          const RomiIcon = romiPositive ? TrendingUp : TrendingDown;
          const bad = c.displaySpend > 0 && c.romi < 0;

          return (
            <div
              key={c.key}
              className={cn(
                "group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-4 transition hover:border-primary/40 hover:bg-card",
                bad && "border-destructive/40",
              )}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1", meta.bg, meta.ring)}>
                    <Icon className={cn("h-4 w-4", meta.cls)} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate text-sm font-semibold" title={c.name}>
                      {c.name}
                      {bad && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                    </div>
                    <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">{meta.label}</div>
                  </div>
                </div>
                {c.displaySpend > 0 ? (
                  <span className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                    romiPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                  )}>
                    <RomiIcon className="h-3 w-3" />
                    {romiPositive ? "+" : ""}{Math.round(c.romi)}%
                  </span>
                ) : isOrganic ? (
                  <span className="rounded-md bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-pink-500">органика</span>
                ) : null}
              </div>

              {/* Leads share bar */}
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Доля заявок</span>
                  <span className="tabular-nums text-foreground/70">{c.leadsShare.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary/40">
                  <div
                    className={cn("h-full rounded-full", isOrganic ? "bg-pink-500" : "bg-primary")}
                    style={{ width: `${Math.min(100, c.leadsShare)}%` }}
                  />
                </div>
              </div>

              {/* KPI grid */}
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[11px]">
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Wallet className="h-3 w-3" /> Расход{showSpendApprox && !c.spend ? "*" : ""}
                  </div>
                  <div className="mt-0.5 font-bold tabular-nums">
                    {isOrganic ? "—" : c.displaySpend > 0 ? fmtTenge(c.displaySpend) : "—"}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3 w-3" /> Заявки
                  </div>
                  <div className="mt-0.5 font-bold tabular-nums">{fmtNum(c.leads)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Цена заявки</div>
                  <div className="mt-0.5 font-bold tabular-nums">{c.cpl > 0 ? fmtTenge(c.cpl) : "—"}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <ShoppingBag className="h-3 w-3" /> Оплаты
                  </div>
                  <div className="mt-0.5 font-bold tabular-nums">{fmtNum(c.sales)}</div>
                </div>
              </div>

              {c.revenue > 0 && (
                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
                  <span className="text-muted-foreground">Выручка</span>
                  <span className="font-bold tabular-nums">{fmtTenge(c.revenue)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showSpendApprox && (
        <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
          * Расход распределён пропорционально доле заявок источника. Точный расход появится после привязки UTM к рекламным кабинетам Meta/Google.
        </div>
      )}
    </div>
  );
}
