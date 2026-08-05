import { memo, useSyncExternalStore, type DragEvent, type MouseEvent } from "react";
import { ArrowRightLeft, Bot, Phone, Sparkles, Star, Tag } from "lucide-react";
import { subscribeAutoMoved, isRecentlyAutoMoved, getAutoMovedSnapshot } from "@/lib/autoMoveTracker";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Lead, LeadStage } from "@/types/crm";
import { leadSlaMinutes, recommendationFor, slaTone } from "@/hooks/useCrmAnalytics";
import { resolveLeadSource } from "@/lib/leadSource";
import { classifyQuality, QUALITY_LABEL, QUALITY_BADGE_CLS } from "@/lib/quality";

interface LeadCardProps {
  lead: Lead;
  assigneeName?: string;
  highlightSla?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  stages?: LeadStage[];
  onSelectToggle?: (leadId: string) => void;
  onClick?: () => void;
  onTogglePin?: (leadId: string) => void;
  onChangeStage?: (leadId: string, stageId: string) => void;
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

function scoreColor(score: number) {
  if (score >= 75) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-muted-foreground";
}

function LeadCardImpl({
  lead,
  assigneeName,
  highlightSla,
  selectMode,
  selected,
  stages,
  onSelectToggle,
  onClick,
  onTogglePin,
  onChangeStage,
}: LeadCardProps) {
  const handleDragStart = (e: DragEvent) => {
    if (selectMode) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/lead-id", lead.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleClick = () => {
    if (selectMode) {
      onSelectToggle?.(lead.id);
      return;
    }
    onClick?.();
  };

  const handleCheckboxClick = (e: MouseEvent) => {
    e.stopPropagation();
    onSelectToggle?.(lead.id);
  };

  const sla = leadSlaMinutes(lead);
  const tone = slaTone(sla);
  const showSlaTimer = highlightSla || (!lead.firstResponseAt && (lead.stageId === "new" || lead.stageId === "no_answer"));
  const rec = recommendationFor(lead.aiScore);
  const otherStages = (stages ?? []).filter((s) => s.id !== lead.stageId);
  const canMoveStage = !selectMode && !!onChangeStage && otherStages.length > 0;

  // Бейдж «🤖 авто» — если лид недавно был автоматически передвинут n8n-WA-анализом
  useSyncExternalStore(subscribeAutoMoved, getAutoMovedSnapshot, getAutoMovedSnapshot);
  const autoMoved = isRecentlyAutoMoved(lead.id);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!selectMode}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        "group relative w-full shrink-0 rounded-xl border bg-card/80 p-3 pb-10 text-left transition-shadow hover:shadow-md",
        selectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        selected ? "border-primary ring-2 ring-primary/30" : lead.pinned ? "border-primary/40 ring-1 ring-primary/20" : "border-border/60 hover:border-primary/50",
        showSlaTimer && tone === "bad" && "ring-1 ring-destructive/40",
      )}
    >
      {selectMode && (
        <div className="absolute left-2 top-2 z-10" onClick={handleCheckboxClick}>
          <Checkbox checked={selected} aria-label={`Выбрать ${lead.name}`} />
        </div>
      )}
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
            {autoMoved && (
              <span
                className="inline-flex items-center gap-0.5 rounded-md bg-primary/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary"
                title="Лид авто-перенесён по результату WA-анализа"
              >
                <Bot className="h-2.5 w-2.5" />
                авто
              </span>
            )}
            <div className="truncate text-sm font-semibold text-foreground">{lead.name}</div>
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Phone className="h-3 w-3" />
            <span className="truncate">{lead.phone}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span
            className={cn(
              "flex items-center gap-0.5 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
              scoreColor(lead.aiScore),
            )}
            title="AI-скоринг качества лида (0–100)"
          >
            <Sparkles className="h-2.5 w-2.5" />
            {lead.aiScore}
          </span>
          {(() => {
            const cat = classifyQuality(lead.aiScore, {
              stageKey: lead.stageId,
              paid: lead.paid,
              paidAt: lead.paidAt,
              diagnosticAmount: lead.diagnosticAmount,
            });
            return (
              <span
                className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", QUALITY_BADGE_CLS[cat])}
                title="Категория качества"
              >
                {QUALITY_LABEL[cat]}
              </span>
            );
          })()}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {(() => {
          const meta = resolveLeadSource(lead);
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

      <div
        className={cn(
          "mt-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
          rec.level === "hot" && "bg-destructive/15 text-destructive",
          rec.level === "warm" && "bg-warning/15 text-warning",
          rec.level === "cold" && "bg-secondary/60 text-muted-foreground",
        )}
      >
        <span>{rec.emoji}</span>
        {rec.label}
      </div>

      {(() => {
        const campaign =
          lead.utm?.campaign
          || lead.utm?.campaign_id
          || null;
        const source = lead.utm?.source || null;
        const adHint = lead.metaAdId || lead.utm?.content || lead.utm?.ad_id || null;
        if (!campaign && !source && !adHint) return null;
        const label = campaign || source || (adHint ? `ad ${adHint}` : null);
        return (
          <div
            className="mt-2 flex items-center gap-1 truncate text-[10px] text-primary/80"
            title={[
              source ? `utm_source: ${source}` : null,
              campaign ? `campaign: ${campaign}` : null,
              adHint ? `ad: ${adHint}` : null,
            ].filter(Boolean).join(" · ")}
          >
            <Tag className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{label}</span>
          </div>
        );
      })()}

      {((lead.tags && lead.tags.length > 0) || lead.temperature || lead.webinarStatus) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {lead.temperature && (
            <span className="rounded bg-warning/15 px-1 py-0.5 text-[9px] font-semibold text-warning">
              {lead.temperature === "hot" ? "🔥" : lead.temperature === "warm" ? "🙂" : "❄️"}
            </span>
          )}
          {lead.webinarStatus && (
            <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
              {lead.webinarStatus}
            </span>
          )}
          {(lead.tags ?? []).slice(0, 2).map((t) => (
            <span key={t} className="max-w-[90px] truncate rounded bg-secondary/70 px-1 py-0.5 text-[9px]">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Активность: {timeAgo(lead.lastActivityAt)}</span>
        {assigneeName ? (
          <span className="truncate rounded bg-secondary/60 px-1.5 py-0.5 font-medium text-foreground/70">
            👤 {assigneeName}
          </span>
        ) : (
          <span className="text-muted-foreground/70">не назначен</span>
        )}
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
            "absolute bottom-2 right-2 grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-secondary",
            "opacity-100 md:opacity-0 md:group-hover:opacity-100",
            lead.pinned && "text-primary opacity-100",
          )}
          title={lead.pinned ? "Открепить" : "Закрепить"}
        >
          <Star className={cn("h-3.5 w-3.5", lead.pinned && "fill-primary")} />
        </span>
      )}

      {canMoveStage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "absolute bottom-2 left-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-muted-foreground transition-opacity hover:bg-secondary hover:text-foreground",
                "opacity-100 md:opacity-0 md:group-hover:opacity-100",
              )}
              title="Сменить этап"
              aria-label="Сменить этап"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span className="hidden xs:inline sm:inline">Этап</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[min(320px,50dvh)] w-56 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {otherStages.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onChangeStage?.(lead.id, s.id);
                }}
              >
                {s.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export const LeadCard = memo(LeadCardImpl);