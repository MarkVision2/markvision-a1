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

const FUNNEL_STEPS: { key: keyof BroadcastFunnel; label: string; hint?: string }[] = [
  { key: "total", label: "В списке рассылки" },
  { key: "sent", label: "Отправлено" },
  { key: "delivered", label: "Получили сообщение" },
  { key: "read", label: "Открыли / прочитали" },
  { key: "replied", label: "Ответили в чат" },
  { key: "clicked", label: "Перешли по ссылке" },
  { key: "groupJoined", label: "Вступили в группу / WA" },
  { key: "leads", label: "Лиды в CRM" },
  { key: "webinarAttended", label: "Пришли на вебинар" },
  { key: "deposits", label: "Предоплата" },
  { key: "sales", label: "Продажи" },
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
  return (
    <div className="space-y-0">
      {FUNNEL_STEPS.map((step, idx) => {
        const value = Number(funnel[step.key] ?? 0);
        const prevKey = idx > 0 ? FUNNEL_STEPS[idx - 1].key : null;
        const prev = prevKey ? Number(funnel[prevKey] ?? 0) : null;
        const rate = prev == null ? null : funnelStepRate(prev, value);
        const highlight = step.key === "sales";
        return (
          <div key={step.key}>
            {idx > 0 && (
              <div className="flex items-center gap-3 py-1 pl-4 text-muted-foreground">
                <div className="h-5 w-px bg-border" />
                <span className="text-xs">
                  ↓
                  {rate != null ? (
                    <span className="ml-2 font-semibold text-foreground">{rate}%</span>
                  ) : null}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex items-center justify-between rounded-xl border border-border/60 bg-card/50 px-4 py-2.5",
                highlight && "border-success/40 bg-success/5",
              )}
              title={step.hint}
            >
              <div className="text-sm font-medium">{step.label}</div>
              <div className="text-base font-bold tabular-nums">{fmtNum(value)}</div>
            </div>
          </div>
        );
      })}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-4 py-3">
        <div className="text-sm font-semibold">Выручка с рассылки</div>
        <div className="text-lg font-bold tabular-nums">{fmtKzt(funnel.revenue)}</div>
      </div>
      {funnel.failed > 0 || funnel.optout > 0 ? (
        <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
          {funnel.failed > 0 ? (
            <span className="text-destructive">Ошибок отправки: {fmtNum(funnel.failed)}</span>
          ) : null}
          {funnel.optout > 0 ? <span>Отписались: {fmtNum(funnel.optout)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated use BroadcastHeroKpis */
export function BroadcastMetricsGrid({ funnel }: { funnel: BroadcastFunnel }) {
  return <BroadcastHeroKpis funnel={funnel} />;
}
