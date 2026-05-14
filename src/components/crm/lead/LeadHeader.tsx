import { useEffect, useState } from "react";
import {
  Star, Sparkles, Wallet, Clock, Phone as PhoneIcon, MessageCircle, Send, Camera, Globe, Tag, Link2,
} from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage, LeadChannel } from "@/types/crm";
import type { TeamMember } from "@/hooks/useTeamStore";
import { InlineEdit } from "./InlineEdit";
import { LeadAttribution } from "./LeadAttribution";
import { recommendationFor, leadSlaMinutes, slaTone } from "@/hooks/useCrmAnalytics";

interface Props {
  lead: Lead;
  stages: LeadStage[];
  members: TeamMember[];
  onUpdate: (patch: Partial<Lead>) => void;
  onTogglePin: () => void;
  onAssign: (assigneeId?: string) => void;
  onChangeStage: (stageId: string) => void;
}

function timeAgo(iso: string, ref: number) {
  const m = Math.max(0, Math.floor((ref - new Date(iso).getTime()) / 60000));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч`;
  return `${Math.floor(h / 24)} д`;
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
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rec = recommendationFor(lead.aiScore);
  const sla = leadSlaMinutes(lead, now);
  const tone = slaTone(sla);
  const stage = stages.find((s) => s.id === lead.stageId);
  const assignee = members.find((m) => m.id === lead.assigneeId);

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
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 font-medium">
              <ChannelIcon channel={lead.channel} />
              {lead.source}
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

      {/* KPI strip */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className={cn(
          "rounded-lg border bg-card/60 p-2",
          rec.level === "hot" && "border-border/60",
          rec.level === "warm" && "border-border/60",
          rec.level === "cold" && "border-border/60",
        )}>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" /> AI-скор
          </div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums">{lead.aiScore}</span>
            <span className="text-xs text-muted-foreground">%</span>
          </div>
          <div className={cn(
            "text-[10px] font-semibold",
            rec.level === "hot" && "text-foreground",
            rec.level === "warm" && "text-foreground",
            rec.level === "cold" && "text-muted-foreground",
          )}>{rec.emoji} {rec.label}</div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/60 p-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3 w-3" /> Потенциал
          </div>
          <div className="mt-0.5 text-xl font-bold tabular-nums">
            <InlineEdit
              value={String(lead.amount || "")}
              onSave={(v) => onUpdate({ amount: Number(v) || 0 })}
              placeholder="0"
              numeric
              suffix="$"
              inputClassName="text-xl font-bold"
              ariaLabel="Сумма сделки"
            />
          </div>
          <div className="text-[10px] text-muted-foreground">
            {lead.amount ? `≈ ${Math.round(lead.amount * lead.aiScore / 100).toLocaleString("ru-RU")} $ ожид.` : "укажите сумму"}
          </div>
        </div>

        <div className={cn(
          "rounded-lg border bg-card/60 p-2",
          tone === "good" && "border-border/60",
          tone === "warn" && "border-border/60",
          tone === "bad" && "border-border/60",
        )}>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3 w-3" /> Таймеры
          </div>
          <div className={cn(
            "mt-0.5 text-base font-bold tabular-nums",
            tone === "good" && "text-foreground",
            tone === "warn" && "text-foreground",
            tone === "bad" && "text-foreground",
          )}>
            {timeAgo(lead.createdAt, now)}
          </div>
          <div className="text-[10px] text-muted-foreground">
            контакт: {timeAgo(lead.lastActivityAt, now)} назад
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