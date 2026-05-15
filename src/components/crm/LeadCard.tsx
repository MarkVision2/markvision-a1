import { memo, type DragEvent } from "react";
import { Clock3, Phone, Star, Tag, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import { leadSlaMinutes, slaTone } from "@/hooks/useCrmAnalytics";
import { normalizeSource } from "@/lib/leadSource";

interface LeadCardProps {
  lead: Lead;
  assigneeName?: string;
  highlightSla?: boolean;
  onClick?: () => void;
  onTogglePin?: (leadId: string) => void;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} д`;
}

function dueLabel(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const absMin = Math.max(1, Math.round(Math.abs(diff) / 60000));
  if (diff < 0) {
    if (absMin < 60) return `просрочено ${absMin} мин`;
    const h = Math.round(absMin / 60);
    return `просрочено ${h} ч`;
  }
  if (absMin < 60) return `через ${absMin} мин`;
  const h = Math.round(absMin / 60);
  if (h < 24) return `через ${h} ч`;
  return `через ${Math.round(h / 24)} д`;
}

function LeadCardImpl({ lead, assigneeName, highlightSla, onClick, onTogglePin }: LeadCardProps) {
  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData("text/lead-id", lead.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const sla = leadSlaMinutes(lead);
  const tone = slaTone(sla);
  const showSlaTimer = highlightSla || (!lead.firstResponseAt && (lead.stageId === "new" || lead.stageId === "no_answer"));
  const nextTask = (lead.tasks ?? [])
    .filter((task) => !task.doneAt)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const taskOverdue = nextTask ? new Date(nextTask.dueAt).getTime() <= Date.now() : false;

  return (
    <button
      type="button"
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
      className={cn(
        "group relative cursor-grab rounded-xl border bg-card/80 p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-elevated active:cursor-grabbing",
        lead.pinned ? "border-primary/40 ring-1 ring-primary/20" : "border-border/60 hover:border-primary/50",
        showSlaTimer && tone === "bad" && "ring-1 ring-destructive/40",
      )}
    >
      {showSlaTimer && (
        <div className="mb-2 flex">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums shadow-sm",
              tone === "good" && "bg-success text-success-foreground",
              tone === "warn" && "bg-warning text-background",
              tone === "bad" && "bg-destructive text-destructive-foreground animate-pulse",
            )}
            title="Время без ответа"
          >
            ⏱ {sla} мин
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {lead.pinned && <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />}
            <div className="truncate text-sm font-semibold text-foreground">{lead.name}</div>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Phone className="h-3 w-3" />
            <span className="truncate">{lead.phone}</span>
          </div>
        </div>
        {assigneeName && (
          <span
            className="inline-flex max-w-[100px] shrink-0 items-center gap-1 truncate rounded-md bg-secondary/70 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
            title={`Ответственный: ${assigneeName}`}
          >
            <UserRound className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{assigneeName}</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {(() => {
          const meta = normalizeSource(lead.source);
          const Icon = meta.Icon;
          return (
            <span
              className={cn(
                "inline-flex min-w-0 items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium",
                meta.cls,
              )}
              title={`Источник: ${meta.label}${lead.channel ? ` · канал: ${lead.channel}` : ""}`}
            >
              <Icon className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{meta.label}</span>
            </span>
          );
        })()}
        <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
          {lead.amount > 0 ? `${lead.amount.toLocaleString("ru-RU")} $` : "—"}
        </span>
      </div>

      {nextTask && (
        <div
          className={cn(
            "mt-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold",
            taskOverdue ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary",
          )}
          title={nextTask.title}
        >
          <Clock3 className="h-3 w-3 shrink-0" />
          <span className="truncate">{nextTask.title}</span>
          <span className="ml-auto shrink-0 tabular-nums">{dueLabel(nextTask.dueAt)}</span>
        </div>
      )}

      {(lead.utm?.campaign || lead.utm?.source) && (
        <div
          className="mt-2 flex items-center gap-1 truncate text-[10px] text-primary/80"
          title={`utm_source: ${lead.utm?.source ?? "—"} · utm_campaign: ${lead.utm?.campaign ?? "—"}`}
        >
          <Tag className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{lead.utm?.campaign ?? lead.utm?.source}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Активность: {timeAgo(lead.lastActivityAt)}</span>
        <span className="text-muted-foreground/70">{lead.channel ?? "канал не указан"}</span>
      </div>

      {onTogglePin && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(lead.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onTogglePin(lead.id);
            }
          }}
          className={cn(
            "absolute bottom-2 right-2 grid h-6 w-6 cursor-pointer place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100",
            lead.pinned && "text-primary opacity-100",
          )}
          title={lead.pinned ? "Открепить" : "Закрепить"}
        >
          <Star className={cn("h-3.5 w-3.5", lead.pinned && "fill-primary")} />
        </span>
      )}
    </button>
  );
}

export const LeadCard = memo(LeadCardImpl);
