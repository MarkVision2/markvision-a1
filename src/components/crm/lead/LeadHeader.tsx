import {
  Star, Phone as PhoneIcon, MessageCircle, Send, Camera, Globe, UserRound,
} from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage, LeadChannel } from "@/types/crm";
import type { TeamMember } from "@/hooks/useTeamStore";
import { InlineEdit } from "./InlineEdit";

interface Props {
  lead: Lead;
  stages: LeadStage[];
  members: TeamMember[];
  onUpdate: (patch: Partial<Lead>) => void;
  onTogglePin: () => void;
  onAssign: (assigneeId?: string) => void;
  onChangeStage: (stageId: string) => void;
}

function ChannelIcon({ channel }: { channel?: LeadChannel }) {
  switch (channel) {
    case "telegram": return <Send className="h-3 w-3" />;
    case "instagram": return <Camera className="h-3 w-3" />;
    case "phone": return <PhoneIcon className="h-3 w-3" />;
    case "web": return <Globe className="h-3 w-3" />;
    default: return <MessageCircle className="h-3 w-3" />;
  }
}

export function LeadHeader({
  lead, stages, members, onUpdate, onTogglePin, onAssign, onChangeStage,
}: Props) {
  const stage = stages.find((s) => s.id === lead.stageId);
  const assignee = members.find((m) => m.id === lead.assigneeId);

  return (
    <div className="border-b border-border/60 bg-background pb-4">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/15 text-lg font-bold text-primary ring-1 ring-primary/30">
          {lead.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 text-xl font-bold leading-tight sm:text-2xl">
              <InlineEdit
                value={lead.name}
                onSave={(v) => v && onUpdate({ name: v })}
                placeholder="Имя"
                ariaLabel="Имя клиента"
              />
            </div>
            <button
              type="button"
              onClick={onTogglePin}
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-secondary",
                lead.pinned && "text-primary",
              )}
              title={lead.pinned ? "Открепить" : "Закрепить"}
            >
              <Star className={cn("h-4 w-4", lead.pinned && "fill-primary")} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-2.5 py-1 font-semibold">
              <ChannelIcon channel={lead.channel} />
              {lead.source}
            </span>

            {/* stage chip with quick switcher */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary hover:bg-primary/20"
                >
                  {stage?.title ?? lead.stageId}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Сменить этап</div>
                {stages.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onChangeStage(s.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-secondary/60",
                      s.id === lead.stageId && "bg-primary/10 font-semibold text-primary",
                    )}
                  >
                    <span>{s.title}</span>
                    {s.id === lead.stageId && <span className="text-[10px]">✓</span>}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* assignee */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2.5 py-1 font-semibold hover:bg-secondary"
                >
                  <UserRound className="h-3.5 w-3.5" />
                  {assignee?.name ?? "не назначен"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56" align="start">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ответственный</div>
                <Select
                  value={lead.assigneeId ?? "none"}
                  onValueChange={(v) => onAssign(v === "none" ? undefined : v)}
                >
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не назначен</SelectItem>
                    {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}
