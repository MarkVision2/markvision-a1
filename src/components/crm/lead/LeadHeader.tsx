import {
  Star, Tag, Globe, Copy, MessageCircle, Mail, MapPin, Clock,
  Phone as PhoneIcon, UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { resolveLeadSource } from "@/lib/leadSource";
import { siteDomain } from "@/lib/analyticsBreakdowns";
import { openWhatsApp } from "@/lib/whatsapp";
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн назад`;
  return "";
}

/** Hide WhatsApp LID digits mistaken for a phone (e.g. +80968874504413). */
function displayablePhone(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  const d = trimmed.replace(/\D/g, "");
  if (d.length < 8 || d.length > 12) return "";
  if (d.startsWith("80")) return "";
  return trimmed;
}

function copyText(value: string, message: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(message),
    () => toast.error("Не удалось скопировать"),
  );
}

export function LeadHeader({
  lead, stages, members, onUpdate, onTogglePin, onAssign, onChangeStage,
}: Props) {
  const stage = stages.find((s) => s.id === lead.stageId);
  const assignee = members.find((m) => m.id === lead.assigneeId);
  const sourceMeta = resolveLeadSource(lead);
  const SourceIcon = sourceMeta.Icon;
  const phone = displayablePhone(lead.phone);
  const createdAgo = lead.createdAt ? timeAgo(lead.createdAt) : "";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3.5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-lg font-semibold tracking-tight text-primary">
          {lead.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-[1.125rem] font-semibold leading-snug tracking-tight sm:text-xl">
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
                "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                lead.pinned && "text-amber-400 hover:text-amber-300",
              )}
              title={lead.pinned ? "Открепить" : "Закрепить"}
            >
              <Star className={cn("h-4 w-4", lead.pinned && "fill-current")} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                "bg-success/10 text-success",
                sourceMeta.cls,
              )}
              title={`Источник: ${sourceMeta.label}${lead.channel ? ` · канал: ${lead.channel}` : ""}`}
            >
              <SourceIcon className="h-3 w-3 shrink-0" />
              {sourceMeta.label}
            </span>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  {stage?.title ?? lead.stageId}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Сменить этап
                </div>
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

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-secondary/70 px-2 py-0.5 text-[11px] text-foreground/90 transition-colors hover:bg-secondary"
                >
                  <UserRound className="h-3 w-3 text-muted-foreground" />
                  {assignee?.name ?? "не назначен"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56" align="start">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Ответственный
                </div>
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

            {createdAgo && (
              <span
                className="inline-flex items-center gap-1 px-1 py-0.5 text-[11px] text-muted-foreground"
                title={`Заявка создана: ${new Date(lead.createdAt).toLocaleString("ru-RU")}`}
              >
                <Clock className="h-3 w-3" />
                {createdAgo}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {phone ? (
              <span className="inline-flex items-center overflow-hidden rounded-full bg-secondary/50 ring-1 ring-border/50">
                <a
                  href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-semibold tabular-nums transition-colors hover:bg-secondary"
                  title="Позвонить"
                >
                  <PhoneIcon className="h-3.5 w-3.5 text-primary" />
                  {phone}
                </a>
                <button
                  type="button"
                  onClick={() => copyText(phone, "Номер скопирован")}
                  className="grid h-full place-items-center px-2 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Скопировать номер"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!openWhatsApp(phone)) toast.error("Не удалось открыть WhatsApp");
                  }}
                  className="grid h-full place-items-center px-2 py-1.5 text-success transition-colors hover:bg-success/10"
                  title="Открыть чат в WhatsApp"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-dashed ring-border/70">
                <PhoneIcon className="h-3.5 w-3.5" />
                нет номера
              </span>
            )}

            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="inline-flex max-w-[200px] items-center gap-1.5 rounded-full bg-secondary/50 px-2.5 py-1.5 text-xs ring-1 ring-border/50 transition-colors hover:bg-secondary"
                title={lead.email}
              >
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{lead.email}</span>
              </a>
            )}

            {lead.city && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/50 px-2.5 py-1.5 text-xs ring-1 ring-border/50">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {lead.city}
              </span>
            )}
          </div>

          {((lead.tags && lead.tags.length > 0) || lead.temperature || lead.webinarStatus || (lead.depositAmount ?? 0) > 0) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {lead.temperature && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                  {lead.temperature === "hot" ? "Горячий" : lead.temperature === "warm" ? "Тёплый" : "Холодный"}
                </span>
              )}
              {lead.webinarStatus && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  Вебинар: {lead.webinarStatus}
                </span>
              )}
              {(lead.depositAmount ?? 0) > 0 && (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                  Бронь {Number(lead.depositAmount).toLocaleString("ru-RU")} ₸
                </span>
              )}
              {(lead.tags ?? []).slice(0, 4).map((t) => (
                <span key={t} className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px]">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <LeadAttribution lead={lead} />
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
  const landingDomain = lead.landingUrl ? siteDomain(lead.landingUrl) : null;
  const showLanding = !!lead.landingUrl && !!landingDomain && landingDomain !== "Сайт не определён";

  if (entries.length === 0 && !showLanding) return null;

  return (
    <div className="rounded-2xl bg-secondary/30 px-3 py-2.5 ring-1 ring-border/40">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <Tag className="h-3 w-3 text-primary" />
          Источник
        </span>

        {showLanding && (
          <a
            href={lead.landingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-background/50 px-2 py-0.5 text-[10px] font-semibold ring-1 ring-border/50 hover:bg-background"
            title={`Страница с формой: ${lead.landingUrl}`}
          >
            <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{landingDomain}</span>
          </a>
        )}

        {entries.map(([k, v]) => (
          <span
            key={k}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-background/50 px-2 py-0.5 text-[10px] ring-1 ring-border/50"
            title={`utm_${k}: ${v}`}
          >
            <span className="font-mono text-muted-foreground">utm_{UTM_LABELS[k] ?? k}</span>
            <span className="truncate font-semibold">{v}</span>
          </span>
        ))}

        {entries.length === 0 && (
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground/70"
            title="Лид пришёл без utm_source/medium/campaign. Проверьте, что форма на сайте передаёт UTM-параметры из URL."
          >
            без UTM
          </span>
        )}
      </div>
    </div>
  );
}
