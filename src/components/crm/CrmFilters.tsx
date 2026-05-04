import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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

  const Chip = ({
    active, onClick, children,
  }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border/60 bg-card/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );

  const hasFilters = !!source || !!assigneeId || !!search;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onChange({ ...state, search: e.target.value })}
            placeholder="Поиск по имени или телефону…"
            className="pl-9"
          />
        </div>
        {hasFilters && (
          <button
            onClick={() => onChange({ search: "", source: null, assigneeId: null })}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
          >
            <X className="h-3 w-3" /> Сбросить
          </button>
        )}
      </div>
      {(sources.length > 0 || members.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
          {sources.length > 0 && (
            <>
              <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Источник:</span>
              <Chip active={source === null} onClick={() => onChange({ ...state, source: null })}>Все</Chip>
              {sources.map((s) => (
                <Chip key={s} active={source === s} onClick={() => onChange({ ...state, source: s })}>
                  {s}
                </Chip>
              ))}
            </>
          )}
          {members.length > 0 && (
            <>
              <span className="ml-2 mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Менеджер:</span>
              <Chip active={assigneeId === null} onClick={() => onChange({ ...state, assigneeId: null })}>Все</Chip>
              {members.map((m) => (
                <Chip key={m.id} active={assigneeId === m.id} onClick={() => onChange({ ...state, assigneeId: m.id })}>
                  {m.name}
                </Chip>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}