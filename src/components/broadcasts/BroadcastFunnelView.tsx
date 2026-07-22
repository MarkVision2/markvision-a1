import { funnelStepRate, type BroadcastFunnel } from "@/lib/broadcastFunnel";
import { fmtKzt, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Eye,
  Link2,
  MessageCircleReply,
  Send,
  ShoppingCart,
  UserPlus,
  Users,
  Video,
} from "lucide-react";

/** Главные KPI — язык как у пользователя: отправили → получили → открыли → … → деньги */
const HERO: {
  key: keyof BroadcastFunnel;
  label: string;
  hint?: string;
  icon: typeof Send;
  tone?: "success" | "primary" | "warning";
  money?: boolean;
}[] = [
  { key: "sent", label: "Отправлено", hint: "ушло в WhatsApp", icon: Send },
  { key: "delivered", label: "Получили", hint: "доставлено", icon: Users, tone: "primary" },
  { key: "read", label: "Открыли", hint: "прочитали сообщение", icon: Eye },
  { key: "clicked", label: "Клики по ссылке", hint: "перешли по ссылке", icon: Link2 },
  { key: "groupJoined", label: "В группе", hint: "этап CRM / WhatsApp", icon: UserPlus },
  { key: "leads", label: "Лиды", hint: "есть в CRM", icon: Users, tone: "primary" },
  { key: "sales", label: "Продажи", hint: "оплачено", icon: ShoppingCart, tone: "success" },
  { key: "revenue", label: "Выручка", hint: "сумма оплат", icon: Banknote, tone: "success", money: true },
];

/** Короткая воронка — без дубля каждого KPI-карточки сверху. */
const FUNNEL_STAGES: {
  key: keyof BroadcastFunnel;
  label: string;
  icon: typeof Send;
  gradient: string;
}[] = [
  {
    key: "total",
    label: "В списке",
    icon: Users,
    gradient: "from-slate-500/85 via-slate-600/70 to-slate-700/55",
  },
  {
    key: "sent",
    label: "Отправлено",
    icon: Send,
    gradient: "from-sky-500/85 via-sky-600/70 to-sky-700/55",
  },
  {
    key: "delivered",
    label: "Получили",
    icon: MessageCircleReply,
    gradient: "from-cyan-500/85 via-cyan-600/70 to-cyan-700/55",
  },
  {
    key: "read",
    label: "Открыли",
    icon: Eye,
    gradient: "from-teal-500/85 via-teal-600/70 to-teal-700/55",
  },
  {
    key: "leads",
    label: "Лиды CRM",
    icon: UserPlus,
    gradient: "from-emerald-500/80 via-emerald-600/65 to-emerald-700/50",
  },
  {
    key: "sales",
    label: "Продажи",
    icon: ShoppingCart,
    gradient: "from-amber-500/80 via-amber-600/65 to-amber-700/50",
  },
];

function stageWidthPct(value: number, max: number): number {
  if (max <= 0) return 42;
  if (value <= 0) return 18;
  return Math.max((value / max) * 100, 22);
}

function trapezoidClip(topPct: number, bottomPct: number): string {
  const tl = (100 - topPct) / 2;
  const tr = tl + topPct;
  const bl = (100 - bottomPct) / 2;
  const br = bl + bottomPct;
  return `polygon(${tl}% 0, ${tr}% 0, ${br}% 100%, ${bl}% 100%)`;
}

export function BroadcastHeroKpis({ funnel }: { funnel: BroadcastFunnel }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {HERO.map((c) => {
        const raw = Number(funnel[c.key] ?? 0);
        const value = c.money ? fmtKzt(raw) : fmtNum(raw);
        const Icon = c.icon;
        return (
          <div
            key={c.key}
            className={cn(
              "rounded-2xl border border-border/60 bg-card/60 p-3",
              c.tone === "success" && "border-success/35 bg-success/5",
              c.tone === "primary" && "border-primary/30 bg-primary/5",
            )}
            title={c.hint}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate">{c.label}</span>
            </div>
            <div className="mt-1.5 text-lg font-bold tabular-nums leading-none sm:text-xl">{value}</div>
            {c.hint ? <div className="mt-1 truncate text-[10px] text-muted-foreground">{c.hint}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function BroadcastConversionStrip({ funnel }: { funnel: BroadcastFunnel }) {
  const pairs: { from: keyof BroadcastFunnel; to: keyof BroadcastFunnel; label: string }[] = [
    { from: "sent", to: "delivered", label: "доставка" },
    { from: "delivered", to: "read", label: "открытие" },
    { from: "sent", to: "replied", label: "ответ" },
    { from: "leads", to: "sales", label: "в оплату" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {pairs.map((p) => {
        const rate = funnelStepRate(Number(funnel[p.from] ?? 0), Number(funnel[p.to] ?? 0));
        return (
          <span
            key={p.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground"
          >
            {p.label}
            <span className="font-bold tabular-nums text-foreground">
              {rate == null ? "—" : `${rate}%`}
            </span>
          </span>
        );
      })}
      {funnel.replied > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground">
          <MessageCircleReply className="h-3 w-3" />
          ответили <span className="font-bold text-foreground">{fmtNum(funnel.replied)}</span>
        </span>
      ) : null}
      {funnel.webinarAttended > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-[11px] text-muted-foreground">
          <Video className="h-3 w-3" />
          вебинар <span className="font-bold text-foreground">{fmtNum(funnel.webinarAttended)}</span>
        </span>
      ) : null}
    </div>
  );
}

export function BroadcastFunnelView({ funnel }: { funnel: BroadcastFunnel }) {
  const values = FUNNEL_STAGES.map((s) => Number(funnel[s.key] ?? 0));
  const max = Math.max(...values, 1);
  const widths = values.map((v) => stageWidthPct(v, max));

  const rates = FUNNEL_STAGES.map((_, i) => {
    if (i === 0) return null;
    return funnelStepRate(values[i - 1], values[i]);
  });

  let worstIdx = -1;
  let worstVal = Infinity;
  rates.forEach((r, i) => {
    if (r != null && r < worstVal && values[i - 1] > 0) {
      worstVal = r;
      worstIdx = i;
    }
  });

  const overall =
    values[0] > 0 ? funnelStepRate(values[0], Number(funnel.sales ?? 0)) : null;
  const openRate =
    Number(funnel.delivered ?? 0) > 0
      ? funnelStepRate(Number(funnel.delivered), Number(funnel.read))
      : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card/50 to-background/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Путь получателя
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {openRate != null ? (
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums">
              Открытие <span className="text-primary">{openRate}%</span>
            </span>
          ) : null}
          {overall != null ? (
            <span className="rounded-full border border-border/50 bg-secondary/40 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums">
              Список → продажа <span className="text-success">{overall}%</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-3 py-4 sm:px-5">
        <div className="mx-auto w-full max-w-lg">
          {FUNNEL_STAGES.map((stage, i) => {
            const topW = widths[i];
            const bottomW =
              i < FUNNEL_STAGES.length - 1
                ? widths[i + 1]
                : Math.max(widths[i] * 0.72, 16);
            const value = values[i];
            const rate = rates[i];
            const isWorst = i === worstIdx && values[i - 1] > 0;
            const isEmpty = value === 0;
            const Icon = stage.icon;
            const isSale = stage.key === "sales";

            return (
              <div key={stage.key}>
                {rate != null && (
                  <div className="relative z-10 flex justify-center py-1.5">
                    <div
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold tabular-nums shadow-sm",
                        isWorst
                          ? "border-destructive/45 bg-destructive/10 text-destructive"
                          : "border-border/60 bg-background/80 text-muted-foreground",
                      )}
                    >
                      <span className="opacity-60">↓</span>
                      <span className={cn(!isWorst && "text-foreground")}>
                        {rate}%
                      </span>
                      {isWorst ? (
                        <span className="rounded bg-destructive/20 px-1 py-px text-[9px] uppercase tracking-wide">
                          узкое место
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}

                <div
                  className={cn(
                    "relative h-[52px] w-full transition-opacity",
                    isEmpty && "opacity-50",
                    isSale && "shadow-[0_0_24px_-8px_hsl(38_80%_50%/0.45)]",
                  )}
                  style={{ clipPath: trapezoidClip(topW, bottomW) }}
                >
                  <div
                    className={cn(
                      "absolute inset-0 bg-gradient-to-b",
                      isEmpty
                        ? "from-secondary/45 via-secondary/30 to-secondary/20"
                        : stage.gradient,
                    )}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-white/5" />
                  <div className="relative flex h-full items-center justify-between gap-3 px-5 sm:px-7">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-black/25 text-white/90">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate text-xs font-bold uppercase tracking-wider text-white/95">
                        {stage.label}
                      </span>
                    </div>
                    <span className="text-lg font-bold tabular-nums text-white drop-shadow-sm">
                      {fmtNum(value)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mx-auto mt-4 flex max-w-lg items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-success" />
            <span className="text-sm font-semibold">Выручка</span>
          </div>
          <span className="text-lg font-bold tabular-nums text-success">
            {fmtKzt(funnel.revenue)}
          </span>
        </div>

        {/* Доп. этапы без дубля основной воронки */}
        <div className="mx-auto mt-4 grid max-w-lg grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Ответили", value: funnel.replied },
            { label: "Клики", value: funnel.clicked },
            { label: "В группе", value: funnel.groupJoined },
            { label: "Вебинар", value: funnel.webinarAttended },
          ].map((x) => (
            <div
              key={x.label}
              className="rounded-xl border border-border/40 bg-background/40 px-3 py-2 text-center"
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {x.label}
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums">{fmtNum(x.value)}</div>
            </div>
          ))}
        </div>

        {(funnel.failed > 0 || funnel.optout > 0) && (
          <div className="mx-auto mt-3 flex max-w-lg flex-wrap gap-3 text-[12px] text-muted-foreground">
            {funnel.failed > 0 ? (
              <span className="text-destructive">Ошибок: {fmtNum(funnel.failed)}</span>
            ) : null}
            {funnel.optout > 0 ? <span>Отписались: {fmtNum(funnel.optout)}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** @deprecated use BroadcastHeroKpis */
export function BroadcastMetricsGrid({ funnel }: { funnel: BroadcastFunnel }) {
  return <BroadcastHeroKpis funnel={funnel} />;
}
