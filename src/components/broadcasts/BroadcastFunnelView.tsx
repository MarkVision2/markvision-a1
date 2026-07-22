import { funnelStepRate, type BroadcastFunnel } from "@/lib/broadcastFunnel";
import { fmtKzt, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS: { key: keyof BroadcastFunnel; label: string; hint?: string }[] = [
  { key: "total", label: "Получатели" },
  { key: "sent", label: "Отправлено" },
  { key: "delivered", label: "Доставлено" },
  { key: "read", label: "Прочитано", hint: "Галочки прочтения WhatsApp" },
  { key: "replied", label: "Ответили" },
  { key: "clicked", label: "Перешли по ссылке", hint: "Когда включён трекинг ссылок" },
  { key: "groupJoined", label: "Вступили в группу / WA", hint: "По этапу CRM" },
  { key: "leads", label: "Лиды в CRM", hint: "Совпали по телефону или связи" },
  { key: "webinarAttended", label: "Пришли на вебинар" },
  { key: "deposits", label: "Предоплата" },
  { key: "sales", label: "Продажи" },
];

export function BroadcastFunnelView({ funnel }: { funnel: BroadcastFunnel }) {
  return (
    <div className="space-y-0">
      {STEPS.map((step, idx) => {
        const value = Number(funnel[step.key] ?? 0);
        const prevKey = idx > 0 ? STEPS[idx - 1].key : null;
        const prev = prevKey ? Number(funnel[prevKey] ?? 0) : null;
        const rate = prev == null ? null : funnelStepRate(prev, value);
        const highlight = step.key === "sales";
        return (
          <div key={step.key}>
            {idx > 0 && (
              <div className="flex items-center gap-3 py-1 pl-4 text-muted-foreground">
                <div className="h-6 w-px bg-border" />
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
                "flex items-center justify-between rounded-xl border border-border/60 bg-card/50 px-4 py-3",
                highlight && "border-success/40 bg-success/5",
              )}
              title={step.hint}
            >
              <div>
                <div className="text-sm font-medium">{step.label}</div>
                {step.hint ? (
                  <div className="text-[11px] text-muted-foreground">{step.hint}</div>
                ) : null}
              </div>
              <div className="text-lg font-bold tabular-nums">{fmtNum(value)}</div>
            </div>
          </div>
        );
      })}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-4 py-3">
        <div className="text-sm font-semibold">Выручка</div>
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

export function BroadcastMetricsGrid({ funnel }: { funnel: BroadcastFunnel }) {
  const cards: { label: string; value: string; tone?: "success" | "warning" | "muted" }[] = [
    { label: "Отправлено", value: fmtNum(funnel.sent) },
    { label: "Доставлено", value: fmtNum(funnel.delivered) },
    { label: "Прочитано", value: fmtNum(funnel.read) },
    { label: "Ответили", value: fmtNum(funnel.replied) },
    { label: "Клики по ссылке", value: fmtNum(funnel.clicked) },
    { label: "В группе / WA", value: fmtNum(funnel.groupJoined) },
    { label: "Лиды", value: fmtNum(funnel.leads) },
    { label: "Вебинар", value: fmtNum(funnel.webinarAttended) },
    { label: "Продажи", value: fmtNum(funnel.sales), tone: "success" },
    { label: "Выручка", value: fmtKzt(funnel.revenue), tone: "success" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn(
            "rounded-xl border border-border/60 bg-card/50 px-3 py-3",
            c.tone === "success" && "border-success/30 bg-success/5",
          )}
        >
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
          <div className="mt-1 text-base font-bold tabular-nums">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
