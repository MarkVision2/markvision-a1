import { Search, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { normalizeSource } from "@/lib/leadSource";
import type { TeamMember } from "@/hooks/useTeamStore";

export interface CrmFilterState {
  search: string;
  source: string | null;
  assigneeId: string | null;
}

interface Props {
  state: CrmFilterState;
  onChange: (s: CrmFilterState) => void;
  sources: string[];
  members: TeamMember[];
}

export function CrmFilters({ state, onChange, sources, members }: Props) {
  const { search, source, assigneeId } = state;
  const hasFilters = !!source || !!assigneeId || !!search.trim();

  const selectedSource = source ? normalizeSource(source) : null;
  const SourceIcon = selectedSource?.Icon;
  const selectedMember = members.find((m) => m.id === assigneeId) ?? null;

  const sortedSources = [...sources].sort((a, b) =>
    normalizeSource(a).label.localeCompare(normalizeSource(b).label, "ru"),
  );

  return (
    <div className="rounded-2xl border border-border/50 bg-card/40 p-2.5 sm:p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onChange({ ...state, search: e.target.value })}
            placeholder="Имя или телефон…"
            className="h-11 border-border/50 bg-background/50 pl-10 text-base sm:h-10 sm:text-sm"
          />
        </div>

        {sources.length > 0 && (
          <Select
            value={source ?? "__all__"}
            onValueChange={(v) =>
              onChange({ ...state, source: v === "__all__" ? null : v })
            }
          >
            <SelectTrigger
              className={cn(
                "h-11 w-full border-border/50 bg-background/50 sm:h-10 sm:w-[200px]",
                source && "border-success/40 bg-success/10 text-foreground",
              )}
            >
              <SelectValue placeholder="Источник">
                <span className="flex min-w-0 items-center gap-2">
                  {SourceIcon ? (
                    <SourceIcon className={cn("h-3.5 w-3.5 shrink-0", selectedSource?.cls)} />
                  ) : null}
                  <span className="truncate">
                    {selectedSource?.label ?? "Все источники"}
                  </span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Все источники</SelectItem>
              {sortedSources.map((s) => {
                const meta = normalizeSource(s);
                const Icon = meta.Icon;
                return (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2">
                      <Icon className={cn("h-3.5 w-3.5", meta.cls)} />
                      <span>{meta.label}</span>
                      {meta.key === "unknown" && meta.raw && meta.raw !== meta.label ? (
                        <span className="text-[10px] text-muted-foreground">({meta.raw})</span>
                      ) : null}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}

        {members.length > 0 && (
          <Select
            value={assigneeId ?? "__all__"}
            onValueChange={(v) =>
              onChange({ ...state, assigneeId: v === "__all__" ? null : v })
            }
          >
            <SelectTrigger
              className={cn(
                "h-11 w-full border-border/50 bg-background/50 sm:h-10 sm:w-[180px]",
                assigneeId && "border-success/40 bg-success/10 text-foreground",
              )}
            >
              <SelectValue placeholder="Менеджер">
                <span className="flex min-w-0 items-center gap-2">
                  <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {selectedMember?.name ?? "Все менеджеры"}
                  </span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Все менеджеры</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasFilters && (
          <button
            type="button"
            onClick={() => onChange({ search: "", source: null, assigneeId: null })}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Сбросить
          </button>
        )}
      </div>
    </div>
  );
}
