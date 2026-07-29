import { funnelStepRate, type BroadcastFunnel } from "@/lib/broadcastFunnel";
import { fmtKzt, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Eye,
  HelpCircle,
  Link2,
  MessageCircleReply,
  Send,
  ShoppingCart,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** KPI: без дубля «В CRM» — вступление уже = лид в системе */
const HERO: {
  key: keyof BroadcastFunnel;
  label: string;
  hint: string;
  how: string;
  icon: typeof Send;
  tone?: "success" | "primary" | "warning";
  money?: boolean;
}[] = [
  {
    key: "sent",
    label: "Отправлено",
    hint: "ушло в WhatsApp",
    how: "Сообщение принято WhatsApp API (sent / delivered / read / click / reply).",
    icon: Send,
  },
  {
    key: "delivered",
    label: "Получили",
    hint: "доставлено",
    how: "Доставлено на телефон или есть факт прочтения / клика / вступления.",
    icon: Users,
    tone: "primary",
  },
  {
    key: "read",
    label: "Прочитали",
    hint: "две синие галочки",
    how: "WhatsApp read receipt. Если отчёты выключены — цифра ниже, пока не будет клика или вступления.",
    icon: Eye,
  },
  {
    key: "clicked",
    label: "Клики",
    hint: "по ссылке / кнопке",
    how: "Переход по кнопке или трекинг-ссылке. Вступление в группу тоже считает клик.",
    icon: Link2,
  },
  {
    key: "joined",
    label: "В группе",
    hint: "реально вступили",
    how: "Человек найден в составе WhatsApp-группы кампании (синк каждые ~2 мин).",
    icon: UserPlus,
    tone: "success",
  },
  {
    key: "webinarAttended",
    label: "Вебинар",
    hint: "посетили",
    how: "Среди вступивших — кто отмечен в CRM как пришедший на вебинар.",
    icon: Video,
    tone: "primary",
  },
  {
    key: "sales",
    label: "Оплаты",
    hint: "полная оплата",
    how: "Оплаченные лиды из этой рассылки (стадия paid+ / флаг paid).",
    icon: ShoppingCart,
    tone: "success",
  },
  {
    key: "revenue",
    label: "Выручка",
    hint: "сумма оплат",
    how: "Сумма amount у оплаченных лидов этой рассылки.",
    icon: Banknote,
    tone: "success",
    money: true,
  },
];

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
    hint: "получатели",
    icon: Users,
    bar: "from-slate-400/80 to-slate-500/45",
  },
  {
    key: "sent",
    label: "Отправлено",
    hint: "ушло в WhatsApp",
    icon: Send,
    bar: "from-sky-400/95 to-sky-600/50",
  },
  {
    key: "delivered",
    label: "Получили",
    hint: "на телефоне",
    icon: MessageCircleReply,
    bar: "from-cyan-400/95 to-cyan-600/50",
  },
  {
    key: "read",
    label: "Прочитали",
    hint: "read receipt",
    icon: Eye,
    bar: "from-teal-400/95 to-teal-600/50",
  },
  {
    key: "clicked",
    label: "Клики",
    hint: "ссылка / кнопка",
    icon: Link2,
    bar: "from-violet-400/90 to-violet-600/45",
  },
  {
    key: "joined",
    label: "В группе",
    hint: "WhatsApp-группа",
    icon: UserPlus,
    bar: "from-emerald-400/95 to-emerald-600/50",
  },
  {
    key: "webinarAttended",
    label: "Вебинар",
    hint: "пришли на эфир",
    icon: Video,
    bar: "from-lime-400/90 to-lime-600/45",
  },
  {
    key: "sales",
    label: "Оплаты",
    hint: "полная оплата",
    icon: ShoppingCart,
    bar: "from-amber-400/95 to-amber-600/50",
  },
];

const GLOSSARY: { title: string; text: string }[] = [
  {
    title: "Прочитали",
    text: "Две синие галочки WhatsApp. Не клик. Без read receipt цифра ниже, пока не будет клика или вступления.",
  },
  {
    title: "Клики",
    text: "Переход по кнопке/ссылке. Вступление в группу автоматически считается кликом.",
  },
  {
    title: "В группе",
    text: "Реально в составе WhatsApp-группы (проверка каждые ~2 минуты). Лид в CRM создаётся/двигается сам.",
  },
  {
    title: "Вебинар → оплата",
    text: "Дальше по CRM: посещение эфира и полная оплата среди вступивших из этой рассылки.",
  },
];

export function BroadcastHeroKpis({ funnel }: { funnel: BroadcastFunnel }) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
        {HERO.map((c) => {
          const raw = Number(funnel[c.key] ?? 0);
          const value = c.money ? fmtKzt(raw) : fmtNum(raw);
          const Icon = c.icon;
          return (
            <Tooltip key={c.key}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "group relative cursor-help overflow-hidden rounded-2xl border border-border/55 bg-card/55 p-3 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_10px_28px_-18px_hsl(162_70%_45%_/_0.55)]",
                    c.tone === "success" && "border-success/30 hover:border-success/50",
                    c.tone === "primary" && "border-primary/25",
                  )}
                >
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute -right-5 -top-5 h-16 w-16 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-60",
                      c.tone === "success" ? "bg-success/40" : "bg-primary/35",
                    )}
                  />
                  <div className="relative flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <Icon className="h-3 w-3 shrink-0 opacity-80" />
                    <span className="min-w-0 truncate">{c.label}</span>
                    <HelpCircle className="ml-auto h-3 w-3 shrink-0 opacity-40" />
                  </div>
                  <div className="relative mt-2 text-xl font-bold tabular-nums tracking-tight sm:text-2xl">
                    {value}
                  </div>
                  <div className="relative mt-1 truncate text-[10px] text-muted-foreground/90">{c.hint}</div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                <p className="font-semibold">{c.label}</p>
                <p className="mt-1 text-muted-foreground">{c.how}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export function BroadcastConversionStrip({ funnel }: { funnel: BroadcastFunnel }) {
  const pairs: { from: keyof BroadcastFunnel; to: keyof BroadcastFunnel; label: string }[] = [
    { from: "sent", to: "delivered", label: "доставка" },
    { from: "delivered", to: "read", label: "прочтение" },
    { from: "read", to: "clicked", label: "клик" },
    { from: "clicked", to: "joined", label: "клик → группа" },
    { from: "joined", to: "webinarAttended", label: "группа → вебинар" },
    { from: "webinarAttended", to: "sales", label: "вебинар → оплата" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {pairs.map((p) => {
        const rate = funnelStepRate(Number(funnel[p.from] ?? 0), Number(funnel[p.to] ?? 0));
        return (
          <span
            key={p.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/40 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-sm"
          >
            {p.label}
            <span className="font-bold tabular-nums text-foreground">
              {rate == null ? "—" : `${rate}%`}
            </span>
          </span>
        );
      })}
      {funnel.replied > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/40 px-2.5 py-1 text-[11px] text-muted-foreground">
          <MessageCircleReply className="h-3 w-3" />
          ответили <span className="font-bold text-foreground">{fmtNum(funnel.replied)}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Воронка: список → … → группа → вебинар → оплата (без дубля «В CRM»).
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
  const joinRate =
    Number(funnel.clicked ?? 0) > 0
      ? funnelStepRate(Number(funnel.clicked), Number(funnel.joined))
      : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/45 shadow-[inset_0_1px_0_hsl(0_0%_100%_/_0.04)] backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-gradient-to-r from-primary/5 via-transparent to-success/5 px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Воронка рассылки
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Список → отправка → доставка → прочтение → клик → группа → вебинар → оплата
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {joinRate != null ? (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
              Клик → группа {joinRate}%
            </span>
          ) : null}
          {overall != null ? (
            <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-success">
              До оплаты {overall}%
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
          const isJoin = stage.key === "joined";

          return (
            <div key={stage.key}>
              {rate != null && (
                <div className="flex items-center gap-2 py-1.5 pl-[7.5rem] sm:pl-40">
                  <div className="h-3 w-px bg-border/80" />
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                      isWorst
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-border/45 bg-background/50 text-muted-foreground",
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
                  "grid grid-cols-[7rem_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 sm:grid-cols-[10rem_1fr_4.5rem]",
                  isSale && "border-success/35 bg-success/5",
                  isJoin && !isSale && "border-emerald-500/30 bg-emerald-500/5",
                  !isSale && !isJoin && "border-border/45 bg-secondary/10",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-bold sm:text-sm">{stage.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{stage.hint}</div>
                </div>

                <div className="relative h-8 overflow-hidden rounded-lg border border-border/35 bg-background/40">
                  <div
                    className={cn(
                      "h-full rounded-lg bg-gradient-to-r shadow-[0_0_18px_-6px_currentColor] transition-all duration-500",
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

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-gradient-to-r from-success/15 to-success/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-success" />
            <div>
              <div className="text-sm font-semibold">Выручка</div>
              <div className="text-[10px] text-muted-foreground">сумма оплат из этой рассылки</div>
            </div>
          </div>
          <span className="text-lg font-bold tabular-nums text-success">{fmtKzt(funnel.revenue)}</span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {GLOSSARY.map((g) => (
            <div
              key={g.title}
              className="rounded-xl border border-border/40 bg-background/35 px-3 py-2.5"
            >
              <div className="text-[11px] font-bold uppercase tracking-wide text-foreground/90">
                {g.title}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{g.text}</p>
            </div>
          ))}
        </div>

        {(funnel.failed > 0 || funnel.optout > 0 || funnel.deposits > 0) && (
          <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
            {funnel.failed > 0 ? (
              <span className="text-destructive">Ошибок отправки: {fmtNum(funnel.failed)}</span>
            ) : null}
            {funnel.optout > 0 ? <span>Отписались: {fmtNum(funnel.optout)}</span> : null}
            {funnel.deposits > 0 ? (
              <span>Бронь / депозит: {fmtNum(funnel.deposits)}</span>
            ) : null}
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
