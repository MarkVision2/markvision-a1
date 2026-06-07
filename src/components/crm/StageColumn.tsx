import { memo, useRef, useState, type DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreVertical,
  Pencil,
  TrendingUp,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LeadCard } from "./LeadCard";
import { getStageIcon, stageColorClasses } from "./StageIcon";
import { leadSlaMinutes } from "@/hooks/useCrmAnalytics";
import type { StageMetrics } from "@/hooks/useCrmAnalytics";
import type { Lead, LeadStage } from "@/types/crm";
import type { TeamMember } from "@/hooks/useTeamStore";

/** Ниже этого порога — обычный flex-список (без absolute), карточки не наезжают друг на друга. */
const VIRTUALIZE_MIN = 35;

interface StageColumnProps {
  stage: LeadStage;
  leads: Lead[];
  metrics?: StageMetrics;
  members: TeamMember[];
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
  onDeleteLeads: (ids: string[]) => void | Promise<void>;
  onDropLead: (leadId: string, stageId: string) => void;
  onOpenLead: (lead: Lead) => void;
  onTogglePin: (leadId: string) => void;
}

function fmtMin(m: number | null) {
  if (m === null || m === 0) return "—";
  if (m < 60) return `${m} мин`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.round(h / 24)} д`;
}

function StageColumnImpl({
  stage,
  leads,
  metrics,
  members,
  isFirst,
  isLast,
  canDelete,
  onRename,
  onMove,
  onDelete,
  onDeleteLeads,
  onDropLead,
  onOpenLead,
  onTogglePin,
}: StageColumnProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(stage.title);
  const [collapsed, setCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const Icon = getStageIcon(stage);
  const colors = stageColorClasses(stage.color);
  const isAlertColumn = stage.id === "no_answer";

  const sortedLeads = [...leads].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (isAlertColumn) {
      return leadSlaMinutes(b) - leadSlaMinutes(a);
    }
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });

  const total = leads.reduce((s, l) => s + (l.amount || 0), 0);
  const useVirtualList = sortedLeads.length >= VIRTUALIZE_MIN;

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sortedLeads.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 200,
    gap: 10,
    overscan: 4,
    enabled: useVirtualList,
  });

  const commitRename = () => {
    const next = draftTitle.trim();
    if (next && next !== stage.title) onRename(stage.id, next);
    setEditing(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const leadId = e.dataTransfer.getData("text/lead-id");
    if (leadId) onDropLead(leadId, stage.id);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleLeadSelection = (leadId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  };

  const selectAllLeads = () => {
    setSelectedIds(new Set(leads.map((l) => l.id)));
  };

  const confirmDeleteLeads = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    if (!confirm(`Удалить ${label}? Это действие нельзя отменить.`)) return;
    await onDeleteLeads(ids);
    exitSelectMode();
  };

  const renderLeadCard = (lead: Lead) => {
    const assignee = members.find((m) => m.id === lead.assigneeId);
    return (
      <LeadCard
        key={lead.id}
        lead={lead}
        assigneeName={assignee?.name}
        highlightSla={isAlertColumn}
        selectMode={selectMode}
        selected={selectedIds.has(lead.id)}
        onSelectToggle={toggleLeadSelection}
        onClick={() => onOpenLead(lead)}
        onTogglePin={onTogglePin}
      />
    );
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "flex h-full min-h-[280px] w-[300px] shrink-0 flex-col rounded-2xl border bg-card/40 p-3 transition-colors",
        isAlertColumn ? "border-destructive/40 bg-destructive/5" : "border-border/60",
        dragOver && "border-primary/60 bg-primary/5",
      )}
    >
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-lg ring-1",
            isAlertColumn
              ? "bg-destructive/15 text-destructive ring-destructive/30"
              : cn(colors.bg, colors.text, colors.ring),
          )}
        >
          {isAlertColumn ? <AlertTriangle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
        </span>

        {editing ? (
          <Input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraftTitle(stage.title);
                setEditing(false);
              }
            }}
            className="h-7 flex-1 px-2 text-sm"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => {
              setDraftTitle(stage.title);
              setEditing(true);
            }}
            className="flex flex-1 items-center gap-2 text-left text-sm font-semibold"
            title="Двойной клик — переименовать"
          >
            <span className="truncate">{stage.title}</span>
            <span
              className={cn(
                "grid min-w-[22px] place-items-center rounded-full px-1.5 text-[10px] font-bold",
                isAlertColumn ? "bg-destructive/20 text-destructive" : cn(colors.bg, colors.text),
              )}
            >
              {leads.length}
            </span>
          </button>
        )}

        {leads.length > 0 && !selectMode && (
          <>
            <button
              type="button"
              onClick={() => {
                setSelectMode(true);
                setSelectedIds(new Set());
              }}
              className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
              title="Выбрать несколько сделок"
              aria-label="Выбрать несколько"
            >
              <CheckSquare className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void confirmDeleteLeads(leads.map((l) => l.id), `все ${leads.length} сделок на этапе «${stage.title}»`)}
              className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title={`Удалить все сделки на этапе (${leads.length})`}
              aria-label="Удалить все на этапе"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-secondary/60"
          aria-label="Свернуть"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", collapsed && "-rotate-90")} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-secondary/60">
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => {
                setDraftTitle(stage.title);
                setEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Переименовать
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(stage.id, -1)} disabled={isFirst}>
              <ChevronLeft className="h-3.5 w-3.5" /> Сдвинуть влево
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(stage.id, 1)} disabled={isLast}>
              <ChevronRight className="h-3.5 w-3.5" /> Сдвинуть вправо
            </DropdownMenuItem>
            {leads.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSelectMode(true);
                    setSelectedIds(new Set());
                  }}
                >
                  <CheckSquare className="h-3.5 w-3.5" /> Выбрать несколько
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void confirmDeleteLeads(leads.map((l) => l.id), `все ${leads.length} сделок на этапе «${stage.title}»`)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Удалить все на этапе ({leads.length})
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(stage.id)}
              disabled={!canDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Удалить этап
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!collapsed && selectMode && (
        <div className="mt-2 shrink-0 flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <span className="text-[10px] font-semibold text-primary">Выбор сделок</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[10px]"
            onClick={selectAllLeads}
          >
            Выбрать все ({leads.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-[10px]"
            disabled={selectedIds.size === 0}
            onClick={() => void confirmDeleteLeads([...selectedIds], `${selectedIds.size} выбранных сделок`)}
          >
            <Trash2 className="h-3 w-3" />
            Удалить выбранные ({selectedIds.size})
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-[10px]"
            onClick={exitSelectMode}
          >
            <X className="h-3 w-3" />
            Отмена
          </Button>
        </div>
      )}

      {!collapsed && (
        <div className="mt-2 shrink-0 grid grid-cols-2 gap-1.5 rounded-lg bg-secondary/20 p-2 text-[10px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Wallet className="h-3 w-3" />
            <span>{(metrics?.potential ?? total).toLocaleString("ru-RU")} $</span>
          </div>
          <div className="flex items-center justify-end gap-1 text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            <span>
              CR:{" "}
              {metrics?.conversionFromPrev !== null && metrics?.conversionFromPrev !== undefined
                ? `${metrics.conversionFromPrev.toFixed(0)}%`
                : "—"}
            </span>
          </div>
          <div className="col-span-2 flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>среднее время в этапе: {fmtMin(metrics?.avgTimeMin ?? null)}</span>
          </div>
        </div>
      )}

      {!collapsed && (
        <div
          ref={listRef}
          className="mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1"
        >
          {sortedLeads.length === 0 ? (
            <div className="grid min-h-[120px] flex-1 place-items-center rounded-xl border border-dashed border-border/60 bg-secondary/20 p-6 text-center text-xs text-muted-foreground">
              <div>
                <Icon className={cn("mx-auto mb-2 h-5 w-5 opacity-60", colors.text)} />
                Перетащите карточку
              </div>
            </div>
          ) : useVirtualList ? (
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const lead = sortedLeads[row.index];
                return (
                  <div
                    key={lead.id}
                    data-index={row.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    {renderLeadCard(lead)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {sortedLeads.map((lead) => renderLeadCard(lead))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const StageColumn = memo(StageColumnImpl);
