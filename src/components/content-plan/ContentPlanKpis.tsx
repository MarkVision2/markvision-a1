import { fmtKzt, fmtNum } from "@/lib/format";
import type { ContentPlanSummary } from "@/lib/contentPlan";
import { cn } from "@/lib/utils";

const CARDS: {
  key: keyof ContentPlanSummary;
  label: string;
  format?: "num" | "money";
  hint?: string;
}[] = [
  { key: "total", label: "Всего публикаций" },
  { key: "scheduled", label: "Запланировано" },
  { key: "awaitingCreation", label: "Ожидает создания" },
  { key: "published", label: "Опубликовано" },
  { key: "avgReach", label: "Средний охват" },
  { key: "avgCodewordComments", label: "Ср. код-слов", hint: "Комментарии/DM с код-словом" },
  { key: "leads", label: "Переходы по ссылке", hint: "Клики из Direct" },
  { key: "registrations", label: "Получено лидов", hint: "Заявки с UTM публикации" },
  { key: "webinarAttended", label: "Посетил вебинар" },
  { key: "paid", label: "Получено оплат" },
  { key: "revenue", label: "Общая выручка", format: "money" },
];

export function ContentPlanKpis({ summary }: { summary: ContentPlanSummary }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {CARDS.map((c) => {
        const raw = summary[c.key];
        const value = c.format === "money" ? fmtKzt(Number(raw)) : fmtNum(Number(raw));
        return (
          <div
            key={c.key}
            className={cn(
              "rounded-2xl border border-border/60 bg-card/60 px-3 py-3",
              c.key === "revenue" && "border-success/30 bg-success/5",
            )}
            title={c.hint}
          >
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums tracking-tight sm:text-xl">{value}</div>
          </div>
        );
      })}
    </div>
  );
}
