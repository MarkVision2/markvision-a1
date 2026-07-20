import { cn } from "@/lib/utils";
import {
  buildLeadJourney,
  formatLeadRegDate,
  utmCampaignLine,
  type LeadJourney,
} from "@/lib/leadJourney";
import { resolveLeadSource } from "@/lib/leadSource";
import type { Lead } from "@/types/crm";
import type { StageRole } from "@/lib/stageRoles";

interface Props {
  lead: Lead;
  /** Compact bar for kanban card */
  compact?: boolean;
  className?: string;
}

function journeyFor(lead: Lead): LeadJourney {
  return buildLeadJourney({
    stageId: lead.stageId,
    stageRole: lead.stageId as StageRole, // stageRoleOf falls back via id
    paid: lead.paid,
    paidAt: lead.paidAt,
    depositAmount: lead.depositAmount,
    webinarStatus: lead.webinarStatus,
  });
}

export function LeadJourneyProgress({ lead, compact, className }: Props) {
  const j = journeyFor(lead);
  const source = resolveLeadSource(lead);
  const utm = utmCampaignLine(lead.utm);
  const reg = formatLeadRegDate(lead.createdAt);

  if (compact) {
    return (
      <div className={cn("mt-2 space-y-1", className)}>
        <div className="flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
          <span>Путь</span>
          <span className="font-semibold text-foreground">{j.progressPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary/80">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              j.isRejected ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${j.progressPct}%` }}
          />
        </div>
        {j.isRejected && j.droppedAt && (
          <div className="truncate text-[9px] text-destructive">
            Отвал: {j.steps.find((s) => s.key === j.droppedAt)?.label ?? j.droppedAt}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("mt-3 rounded-xl border border-border/60 bg-card/40 p-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Путь до покупки
          </div>
          <div className="mt-0.5 text-sm font-semibold">
            Прогресс: {j.progressPct}%
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({j.doneCount}/{j.total})
            </span>
          </div>
        </div>
        {j.isRejected && (
          <span className="rounded-md bg-destructive/15 px-2 py-1 text-[10px] font-semibold text-destructive">
            Отказ
            {lead.rejectReason ? ` · ${lead.rejectReason}` : ""}
          </span>
        )}
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary/80">
        <div
          className={cn("h-full rounded-full", j.isRejected ? "bg-destructive" : "bg-primary")}
          style={{ width: `${j.progressPct}%` }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
        <div className="flex justify-between gap-2 rounded-md bg-secondary/40 px-2 py-1">
          <dt className="text-muted-foreground">Источник</dt>
          <dd className="truncate font-medium">{source.label}</dd>
        </div>
        {utm && (
          <div className="flex justify-between gap-2 rounded-md bg-secondary/40 px-2 py-1">
            <dt className="text-muted-foreground">UTM</dt>
            <dd className="truncate font-medium" title={utm}>{utm}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2 rounded-md bg-secondary/40 px-2 py-1">
          <dt className="text-muted-foreground">Регистрация</dt>
          <dd className="font-medium">{reg}</dd>
        </div>
        {(lead.depositAmount ?? 0) > 0 && (
          <div className="flex justify-between gap-2 rounded-md bg-success/10 px-2 py-1 text-success">
            <dt>Бронь</dt>
            <dd className="font-semibold">{Number(lead.depositAmount).toLocaleString("ru-RU")} ₸</dd>
          </div>
        )}
      </dl>

      <ul className="mt-3 space-y-1">
        {j.steps.map((s) => (
          <li
            key={s.key}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[12px]",
              s.done ? "bg-success/10 text-foreground" : "bg-secondary/30 text-muted-foreground",
              j.isRejected && !s.done && s.key === j.droppedAt && "ring-1 ring-destructive/40",
            )}
          >
            <span>{s.label}</span>
            <span className={cn("font-semibold", s.done ? "text-success" : "text-muted-foreground")}>
              {s.done ? "✅" : "❌"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
