import {
  AlertTriangle,
  Camera,
  Globe,
  MessageCircle,
  Music2,
  Search,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
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

const PROVIDER_META: Record<
  ChannelProvider,
  {
    icon: typeof Camera;
    cls: string;
    bg: string;
    ring: string;
    bar: string;
    label: string;
    hint: string;
  }
> = {
  whatsapp: {
    icon: MessageCircle,
    cls: "text-emerald-400",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/25",
    bar: "bg-emerald-500",
    label: "WhatsApp",
    hint: "Сообщения и клики в WhatsApp из Meta Ads",
  },
  site: {
    icon: Globe,
    cls: "text-sky-400",
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/25",
    bar: "bg-sky-500",
    label: "Сайт / лендинг",
    hint: "Лид-формы Meta и заявки с сайта",
  },
  instagram: {
    icon: Camera,
    cls: "text-pink-400",
    bg: "bg-pink-500/10",
    ring: "ring-pink-500/25",
    bar: "bg-pink-500",
    label: "Instagram",
    hint: "Органика и код-слова в Reels",
  },
  google: {
    icon: Search,
    cls: "text-amber-400",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/25",
    bar: "bg-amber-500",
    label: "Google Ads",
    hint: "Поиск и Performance Max",
  },
  tiktok: {
    icon: Music2,
    cls: "text-foreground",
    bg: "bg-secondary/60",
    ring: "ring-border/40",
    bar: "bg-primary",
    label: "TikTok Ads",
    hint: "Реклама в TikTok",
  },
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
  enriched.sort((a, b) => b.leads - a.leads || b.displaySpend - a.displaySpend);

  const showSpendApprox = !hasExplicitSpend && totalSpend > 0;
  const primaryCount = enriched.filter((c) => c.provider === "whatsapp" || c.provider === "site").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Заявок по источникам: <span className="font-semibold text-foreground">{fmtNum(totalLeads)}</span>
        </span>
        {totalSpend > 0 && (
          <span>
            Расход Meta/Google: <span className="font-semibold text-foreground">{fmtTenge(totalSpend)}</span>
          </span>
        )}
      </div>

      <div
        className={cn(
          "grid gap-3",
          primaryCount === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {enriched.map((c) => {
          const meta = PROVIDER_META[c.provider] ?? PROVIDER_META.site;
          const Icon = meta.icon;
          const isOrganic = c.provider === "instagram" && c.spend === 0;
          const romiPositive = c.romi >= 0;
          const RomiIcon = romiPositive ? TrendingUp : TrendingDown;
          const measuredLoss = c.displaySpend > 0 && c.revenue > 0 && c.romi < 0;
          const noSales = c.displaySpend > 0 && c.revenue === 0;
          const bad = measuredLoss;

          return (
            <div
              key={c.key}
              className={cn(
                "group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card/80 to-card/40 p-4 transition hover:border-primary/30",
                c.provider === "whatsapp" && "border-emerald-500/20 hover:border-emerald-500/40",
                c.provider === "site" && "border-sky-500/20 hover:border-sky-500/40",
                !["whatsapp", "site"].includes(c.provider) && "border-border/60",
                bad && "border-destructive/40",
              )}
            >
              <div
                className={cn(
                  "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl",
                  c.provider === "whatsapp" && "bg-emerald-500",
                  c.provider === "site" && "bg-sky-500",
                  c.provider === "instagram" && "bg-pink-500",
                )}
              />

              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1", meta.bg, meta.ring)}>
                    <Icon className={cn("h-5 w-5", meta.cls)} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate text-base font-bold" title={c.name}>
                      {meta.label}
                      {bad && <span title="Выручка меньше расхода — реклама убыточна"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" /></span>}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{meta.hint}</div>
                  </div>
                </div>
                {c.displaySpend > 0 && c.revenue > 0 ? (
                  <span
                    title="Окупаемость рекламы (ROMI): (выручка − расход) ÷ расход"
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold tabular-nums",
                      romiPositive ? "bg-emerald-500/15 text-emerald-400" : "bg-destructive/15 text-destructive",
                    )}
                  >
                    <RomiIcon className="h-3 w-3" />
                    {romiPositive ? "+" : ""}{Math.round(c.romi)}%
                  </span>
                ) : noSales ? (
                  <span title="За период есть расход, но оплат ещё нет" className="shrink-0 rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-500">нет оплат</span>
                ) : isOrganic ? (
                  <span className="rounded-lg bg-pink-500/15 px-2 py-1 text-[10px] font-bold uppercase text-pink-400">органика</span>
                ) : null}
              </div>

              <div className="relative mt-4">
                <div className="mb-1.5 flex items-end justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Заявки</div>
                    <div className="text-2xl font-bold tabular-nums leading-none">{fmtNum(c.leads)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Доля</div>
                    <div className="text-sm font-semibold tabular-nums text-foreground/80">{c.leadsShare.toFixed(0)}%</div>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary/50">
                  <div
                    className={cn("h-full rounded-full transition-all", meta.bar)}
                    style={{ width: `${Math.min(100, Math.max(c.leads > 0 ? 4 : 0, c.leadsShare))}%` }}
                  />
                </div>
              </div>

              <div className="relative mt-4 grid grid-cols-3 gap-2 rounded-xl border border-border/40 bg-background/30 p-2.5 text-[11px]">
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Wallet className="h-3 w-3" />
                    Расход{showSpendApprox && !c.spend ? "*" : ""}
                  </div>
                  <div className="mt-1 font-bold tabular-nums">
                    {isOrganic ? "—" : c.displaySpend > 0 ? fmtTenge(c.displaySpend) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Цена заявки</div>
                  <div className="mt-1 font-bold tabular-nums">{c.cpl > 0 ? fmtTenge(c.cpl) : "—"}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <ShoppingBag className="h-3 w-3" />
                    Оплаты
                  </div>
                  <div className="mt-1 font-bold tabular-nums">{fmtNum(c.sales)}</div>
                </div>
              </div>

              {c.revenue > 0 && (
                <div className="relative mt-3 flex items-center justify-between rounded-xl bg-success/10 px-3 py-2 text-[11px]">
                  <span className="text-muted-foreground">Выручка CRM</span>
                  <span className="font-bold tabular-nums text-success">{fmtTenge(c.revenue)}</span>
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
