import {
  Star, Phone as PhoneIcon, MessageCircle, Tag, Link2, Globe,
} from "lucide-react";

import { resolveLeadSource } from "@/lib/leadSource";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage } from "@/types/crm";
import type { TeamMember } from "@/hooks/useTeamStore";
import { InlineEdit } from "./InlineEdit";
import { LeadAttribution } from "./LeadAttribution";

interface Props {
  lead: Lead;
  stages: LeadStage[];
  members: TeamMember[];
  onUpdate: (patch: Partial<Lead>) => void;
  onTogglePin: () => void;
  onAssign: (assigneeId?: string) => void;
  onChangeStage: (stageId: string) => void;
}

export function LeadHeader({
  lead, stages, members, onUpdate, onTogglePin, onAssign, onChangeStage,
}: Props) {
  const stage = stages.find((s) => s.id === lead.stageId);
  const assignee = members.find((m) => m.id === lead.assigneeId);
  const sourceMeta = resolveLeadSource(lead);
  const SourceIcon = sourceMeta.Icon;

  return (
    <div className="border-b border-border/60 bg-background pb-3">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-base font-bold text-primary ring-1 ring-primary/30">
          {lead.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1 text-base font-bold leading-tight sm:text-lg">
              <InlineEdit
                value={lead.name}
                onSave={(v) => v && onUpdate({ name: v })}
                placeholder="Имя"
                ariaLabel="Имя клиента"
                wrap
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

          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 font-medium",
                sourceMeta.cls,
              )}
              title={`Источник: ${sourceMeta.label}${lead.channel ? ` · канал: ${lead.channel}` : ""}`}
            >
              <SourceIcon className="h-3 w-3 shrink-0" />
              {sourceMeta.label}
            </span>

            {/* stage chip with quick switcher */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary hover:bg-primary/20"
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
                  className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 hover:bg-secondary"
                >
                  👤 {assignee?.name ?? "не назначен"}
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

      {/* Откуда пришёл лид (конкретный креатив Meta) */}
      <LeadAttribution lead={lead} />

      {/* Атрибуция и UTM */}
      <UtmStrip lead={lead} />
    </div>
  );
}

const UTM_LABELS: Record<string, string> = {
  source: "source",
  medium: "medium",
  campaign: "campaign",
  content: "content",
  term: "term",
};

function UtmStrip({ lead }: { lead: Lead }) {
  const entries = lead.utm
    ? (Object.entries(lead.utm).filter(([, v]) => !!v) as Array<[string, string]>)
    : [];
  const hasAny = entries.length > 0 || !!lead.referrer || !!lead.landingUrl;

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-card/40 p-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Tag className="h-3 w-3 text-primary" />
        Источник и UTM
      </div>

      {entries.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entries.map(([k, v]) => (
            <span
              key={k}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px]"
              title={`utm_${k}: ${v}`}
            >
              <span className="font-mono text-muted-foreground">utm_{UTM_LABELS[k] ?? k}</span>
              <span className="truncate font-semibold">{v}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          UTM-метки не зафиксированы
          <span className="ml-1 text-muted-foreground/70" title="Лид пришёл без utm_source/medium/campaign. Проверьте, что форма на сайте передаёт UTM-параметры из URL.">
            ⓘ
          </span>
        </div>
      )}

      {hasAny && (lead.referrer || lead.landingUrl) && (
        <div className="mt-1.5 grid gap-0.5 border-t border-border/60 pt-1.5 text-[10px] text-muted-foreground">
          {lead.landingUrl && (
            <div className="flex items-start gap-1">
              <Globe className="mt-0.5 h-3 w-3 shrink-0" />
              <a
                href={lead.landingUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-foreground/80 hover:underline"
                title={lead.landingUrl}
              >
                {lead.landingUrl}
              </a>
            </div>
          )}
          {lead.referrer && (
            <div className="flex items-start gap-1">
              <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="truncate text-foreground/80" title={lead.referrer}>
                {lead.referrer}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}