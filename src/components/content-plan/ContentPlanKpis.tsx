import { fmtKzt, fmtNum } from "@/lib/format";
import type { ContentPlanSummary } from "@/lib/contentPlan";
import { cn } from "@/lib/utils";

type CardDef = {
  key: keyof ContentPlanSummary;
  label: string;
  format?: "num" | "money";
  hint?: string;
};

const PLAN_CARDS: CardDef[] = [
  { key: "total", label: "Всего" },
  { key: "scheduled", label: "В плане" },
  { key: "awaitingCreation", label: "В работе" },
  { key: "published", label: "Вышло" },
];

const RESULT_CARDS: CardDef[] = [
  { key: "avgReach", label: "Ср. охват", hint: "Средний охват опубликованных" },
  { key: "avgCodewordComments", label: "Ср. код-слов", hint: "Комментарии/DM с код-словом" },
  { key: "leads", label: "Переходы", hint: "Клики из Direct" },
  { key: "registrations", label: "Лиды", hint: "Заявки с UTM публикации" },
  { key: "webinarAttended", label: "Вебинар" },
  { key: "paid", label: "Оплаты" },
  { key: "revenue", label: "Выручка", format: "money" },
];

function MetricCard({
  card,
  summary,
  emphasize,
}: {
  card: CardDef;
  summary: ContentPlanSummary;
  emphasize?: boolean;
}) {
  const raw = summary[card.key];
  const value = card.format === "money" ? fmtKzt(Number(raw)) : fmtNum(Number(raw));
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5",
        emphasize && "border-success/30 bg-success/5",
      )}
      title={card.hint}
    >
      <div className="truncate text-[11px] text-muted-foreground">{card.label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

export function ContentPlanKpis({
  summary,
  periodLabel,
  presetLabel,
}: {
  summary: ContentPlanSummary;
  periodLabel: string;
  presetLabel: string;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Сводка за период</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {presetLabel}
            <span className="mx-1.5 text-border">·</span>
            <span className="tabular-nums">{periodLabel}</span>
          </p>
        </div>
        <p className="max-w-lg text-[11px] leading-relaxed text-muted-foreground">
          Считаем публикации за выбранный отрезок. Статистика — с Instagram (не важно, пост
          вышел вручную или через автопост): охват из media, воронка по событиям на этот
          media_id.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          План
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PLAN_CARDS.map((c) => (
            <MetricCard key={c.key} card={c} summary={summary} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Результат
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {RESULT_CARDS.map((c) => (
            <MetricCard key={c.key} card={c} summary={summary} emphasize={c.key === "revenue"} />
          ))}
        </div>
      </div>
    </section>
  );
}
