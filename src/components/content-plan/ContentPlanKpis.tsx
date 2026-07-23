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
  { key: "published", label: "Вышло" },
];

const RESULT_CARDS: CardDef[] = [
  { key: "totalReach", label: "Охват", hint: "Сумма охвата опубликованных постов из Instagram" },
  {
    key: "codewordHits",
    label: "Код-слова",
    hint: "Сколько раз написали код-слово в комментарии или Direct по этим постам",
  },
  { key: "linkClicks", label: "Переходы", hint: "Клики по ссылке из автоответа Direct" },
  { key: "registrations", label: "Лиды", hint: "Заявки, привязанные к этим срабатываниям" },
  { key: "webinarAttended", label: "Вебинар" },
  { key: "paid", label: "Оплаты" },
  { key: "revenue", label: "Выручка", format: "money" },
  {
    key: "adSpend",
    label: "Реклама",
    format: "money",
    hint: "Только расход буста поста (связка Meta Ads ↔ IG media). Иначе ручное поле или 0",
  },
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
          Охват — сумма Instagram reach. Код-слова / переходы / лиды — реальные события
          (коммент или DM с код-словом → клик → заявка) по опубликованным постам, без
          умножения на все слоты плана.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          План
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PLAN_CARDS.map((c) => (
            <MetricCard key={c.key} card={c} summary={summary} />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Результат
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {RESULT_CARDS.map((c) => (
            <MetricCard
              key={c.key}
              card={c}
              summary={summary}
              emphasize={c.key === "revenue" || c.key === "codewordHits"}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
