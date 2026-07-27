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

/** Главные KPI — язык как у пользователя */
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
  { key: "joined", label: "Вступили в группу", hint: "реально в WhatsApp-группе", icon: UserPlus, tone: "success" },
  { key: "leads", label: "Лиды", hint: "есть в CRM", icon: Users, tone: "primary" },
  { key: "sales", label: "Продажи", hint: "оплачено", icon: ShoppingCart, tone: "success" },
  { key: "revenue", label: "Выручка", hint: "сумма оплат", icon: Banknote, tone: "success", money: true },
];

/** Этапы воронки — короткие понятные названия, текст всегда снаружи бара */
const FUNNEL_STAGES: {
  key: keyof BroadcastFunnel;
  label: string;
  hint: string;
  icon: typeof Send;
  bar: string;
}[] = [
  {
    key: "total",
    label: "В списке",
    hint: "всего получателей",
    icon: Users,
    bar: "from-slate-400/80 to-slate-500/50",
  },
  {
    key: "sent",
    label: "Отправлено",
    hint: "сообщение ушло",
    icon: Send,
    bar: "from-sky-400/90 to-sky-600/55",
  },
  {
    key: "delivered",
    label: "Получили",
    hint: "доставлено на телефон",
    icon: MessageCircleReply,
    bar: "from-cyan-400/90 to-cyan-600/55",
  },
  {
    key: "read",
    label: "Открыли",
    hint: "прочитали в WhatsApp",
    icon: Eye,
    bar: "from-teal-400/90 to-teal-600/55",
  },
  {
    key: "leads",
    label: "Лиды в CRM",
    hint: "есть карточка в CRM",
    icon: UserPlus,
    bar: "from-emerald-400/85 to-emerald-600/50",
  },
  {
    key: "sales",
    label: "Продажи",
    hint: "оплатили",
    icon: ShoppingCart,
    bar: "from-amber-400/90 to-amber-600/55",
  },
];

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
    { from: "read", to: "clicked", label: "клик" },
    { from: "clicked", to: "joined", label: "перешли→вступили" },
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

/**
 * Читаемая воронка: название слева (не обрезается), полоска по доле от максимума,
 * число справа. Между ступенями — % перехода.
 */
export function BroadcastFunnelView({ funnel }: { funnel: BroadcastFunnel }) {
  const values = FUNNEL_STAGES.map((s) => Number(funnel[s.key] ?? 0));
  const max = Math.max(...values, 1);

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
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Воронка рассылки
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
              До продажи <span className="text-success">{overall}%</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-1 p-4">
        {FUNNEL_STAGES.map((stage, i) => {
          const value = values[i];
          const rate = rates[i];
          const isWorst = i === worstIdx && values[i - 1] > 0;
          const widthPct = value > 0 ? Math.max((value / max) * 100, 8) : 0;
          const Icon = stage.icon;
          const isSale = stage.key === "sales";

          return (
            <div key={stage.key}>
              {rate != null && (
                <div className="flex items-center gap-2 py-1.5 pl-[7.5rem] sm:pl-36">
                  <div className="h-3 w-px bg-border" />
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                      isWorst
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border/50 bg-background/60 text-muted-foreground",
                    )}
                  >
                    ↓ {rate}%
                    <span className="font-medium opacity-80">
                      {FUNNEL_STAGES[i - 1].label} → {stage.label}
                    </span>
                    {isWorst ? (
                      <span className="rounded bg-destructive/20 px-1 text-[9px] uppercase">
                        узкое место
                      </span>
                    ) : null}
                  </span>
                </div>
              )}

              <div
                className={cn(
                  "grid grid-cols-[7rem_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 sm:grid-cols-[9rem_1fr_4.5rem]",
                  isSale
                    ? "border-success/35 bg-success/5"
                    : "border-border/50 bg-secondary/15",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-bold sm:text-sm">{stage.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{stage.hint}</div>
                </div>

                <div className="relative h-8 overflow-hidden rounded-lg border border-border/40 bg-background/50">
                  <div
                    className={cn(
                      "h-full rounded-lg bg-gradient-to-r transition-all duration-500",
                      stage.bar,
                      value === 0 && "opacity-0",
                    )}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>

                <div className="text-right text-base font-bold tabular-nums sm:text-lg">
                  {fmtNum(value)}
                </div>
              </div>
            </div>
          );
        })}

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-success" />
            <div>
              <div className="text-sm font-semibold">Выручка</div>
              <div className="text-[10px] text-muted-foreground">сумма оплат из CRM</div>
            </div>
          </div>
          <span className="text-lg font-bold tabular-nums text-success">{fmtKzt(funnel.revenue)}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Клики", hint: "перешли по ссылке", value: funnel.clicked },
            { label: "Вступили в группу", hint: "реально в группе", value: funnel.joined },
            { label: "Ответили", hint: "написали в чат", value: funnel.replied },
            { label: "Продажи", hint: "оплатили", value: funnel.sales },
          ].map((x) => (
            <div
              key={x.label}
              className="rounded-xl border border-border/40 bg-background/40 px-3 py-2"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {x.label}
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums">{fmtNum(x.value)}</div>
              <div className="text-[10px] text-muted-foreground">{x.hint}</div>
            </div>
          ))}
        </div>

        {(funnel.failed > 0 || funnel.optout > 0) && (
          <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
            {funnel.failed > 0 ? (
              <span className="text-destructive">Ошибок отправки: {fmtNum(funnel.failed)}</span>
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
