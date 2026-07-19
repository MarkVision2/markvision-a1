import { funnelStepRate, type ContentPlanFunnel } from "@/lib/contentPlan";
import { fmtKzt, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS: { key: keyof ContentPlanFunnel; label: string }[] = [
  { key: "views", label: "Просмотры" },
  { key: "comments", label: "Комментарии" },
  { key: "codewordHits", label: "Кодовое слово" },
  { key: "messagesSent", label: "Отправлено сообщение" },
  { key: "linkClicks", label: "Переход по ссылке" },
  { key: "registrations", label: "Регистрация" },
  { key: "whatsappJoined", label: "Вступил в WhatsApp" },
  { key: "webinarAttended", label: "Пришёл на вебинар" },
  { key: "deposits", label: "Предоплата" },
  { key: "paid", label: "Оплата" },
];

export function ContentPlanFunnelView({ funnel }: { funnel: ContentPlanFunnel }) {
  return (
    <div className="space-y-0">
      {STEPS.map((step, idx) => {
        const value = Number(funnel[step.key] ?? 0);
        const prev = idx > 0 ? Number(funnel[STEPS[idx - 1].key] ?? 0) : null;
        const rate = prev == null ? null : funnelStepRate(prev, value);
        return (
          <div key={step.key}>
            {idx > 0 && (
              <div className="flex items-center gap-3 py-1 pl-4 text-muted-foreground">
                <div className="h-6 w-px bg-border" />
                <span className="text-xs">
                  ↓{rate != null ? <span className="ml-2 font-semibold text-foreground">{rate}%</span> : null}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex items-center justify-between rounded-xl border border-border/60 bg-card/50 px-4 py-3",
                step.key === "paid" && "border-success/40 bg-success/5",
              )}
            >
              <div className="text-sm font-medium">{step.label}</div>
              <div className="text-lg font-bold tabular-nums">{fmtNum(value)}</div>
            </div>
          </div>
        );
      })}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-4 py-3">
        <div className="text-sm font-semibold">Выручка</div>
        <div className="text-lg font-bold tabular-nums">{fmtKzt(funnel.revenue)}</div>
      </div>
    </div>
  );
}

export function ContentPlanMetricsGrid({ funnel }: { funnel: ContentPlanFunnel }) {
  const cards: { label: string; value: string; hint?: string }[] = [
    { label: "Охват", value: fmtNum(funnel.reach) },
    { label: "Просмотры", value: fmtNum(funnel.views) },
    { label: "Лайки", value: fmtNum(funnel.likes) },
    { label: "Сохранения", value: fmtNum(funnel.saves) },
    { label: "Репосты", value: fmtNum(funnel.shares) },
    { label: "Комментарии", value: fmtNum(funnel.comments), hint: "Пользовательские" },
    { label: "Код-слов", value: fmtNum(funnel.codewordHits) },
    { label: "Отправлено DM", value: fmtNum(funnel.messagesSent) },
    { label: "Открыли сообщение", value: fmtNum(funnel.messagesOpened) },
    { label: "Перешли по ссылке", value: fmtNum(funnel.linkClicks) },
    { label: "Регистрации", value: fmtNum(funnel.registrations) },
    { label: "WhatsApp", value: fmtNum(funnel.whatsappJoined) },
    { label: "Вебинар", value: fmtNum(funnel.webinarAttended) },
    { label: "Предоплата", value: fmtNum(funnel.deposits) },
    { label: "Полная оплата", value: fmtNum(funnel.paid) },
    { label: "Выручка", value: fmtKzt(funnel.revenue) },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-border/60 bg-card/50 px-3 py-3" title={c.hint}>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
          <div className="mt-1 text-base font-bold tabular-nums">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
