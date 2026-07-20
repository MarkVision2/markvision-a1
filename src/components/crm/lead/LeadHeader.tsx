import {
  Star, Tag, Globe, Copy, MessageCircle, Mail, MapPin, Clock,
  Phone as PhoneIcon,
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
import { LeadJourneyProgress } from "./LeadJourneyProgress";

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
  const phone = lead.phone?.trim();
  const createdAgo = lead.createdAt ? timeAgo(lead.createdAt) : "";

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

            {createdAgo && (
              <span
                className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-muted-foreground"
                title={`Заявка создана: ${new Date(lead.createdAt).toLocaleString("ru-RU")}`}
              >
                <Clock className="h-3 w-3" />
                {createdAgo}
              </span>
            )}
          </div>

          {/* Контакты: телефон + быстрые действия, email, город */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {phone ? (
              <span className="inline-flex items-center overflow-hidden rounded-lg border border-border/70 bg-secondary/40">
                <a
                  href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex items-center gap-1.5 px-2 py-1 font-semibold tabular-nums hover:bg-secondary"
                  title="Позвонить"
                >
                  <PhoneIcon className="h-3 w-3 text-primary" />
                  {phone}
                </a>
                <button
                  type="button"
                  onClick={() => copyText(phone, "Номер скопирован")}
                  className="grid h-full place-items-center border-l border-border/60 px-1.5 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title="Скопировать номер"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!openWhatsApp(phone)) toast.error("Не удалось открыть WhatsApp");
                  }}
                  className="grid h-full place-items-center border-l border-border/60 px-1.5 py-1 text-success hover:bg-success/10"
                  title="Открыть чат в WhatsApp"
                >
                  <MessageCircle className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2 py-1 text-muted-foreground">
                <PhoneIcon className="h-3 w-3" />
                нет номера
              </span>
            )}

            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/40 px-2 py-1 hover:bg-secondary"
                title={lead.email}
              >
                <Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{lead.email}</span>
              </a>
            )}

            {lead.city && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/40 px-2 py-1">
                <MapPin className="h-3 w-3 text-muted-foreground" />
                {lead.city}
              </span>
            )}
          </div>

          {((lead.tags && lead.tags.length > 0) || lead.temperature || lead.webinarStatus || (lead.depositAmount ?? 0) > 0) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {lead.temperature && (
                <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                  {lead.temperature === "hot" ? "🔥 Горячий" : lead.temperature === "warm" ? "🙂 Тёплый" : "❄️ Холодный"}
                </span>
              )}
              {lead.webinarStatus && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Вебинар: {lead.webinarStatus}
                </span>
              )}
              {(lead.depositAmount ?? 0) > 0 && (
                <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                  Бронь {Number(lead.depositAmount).toLocaleString("ru-RU")} ₸
                </span>
              )}
              {(lead.tags ?? []).slice(0, 4).map((t) => (
                <span key={t} className="rounded-md bg-secondary/70 px-1.5 py-0.5 text-[10px]">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Путь до покупки (Launch Funnel) */}
      <LeadJourneyProgress lead={lead} />

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
  const landingDomain = lead.landingUrl ? siteDomain(lead.landingUrl) : null;
  const showLanding = !!lead.landingUrl && !!landingDomain && landingDomain !== "Сайт не определён";

  // Совсем нет данных об источнике — не занимаем место пустой плашкой.
  if (entries.length === 0 && !showLanding) return null;

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-card/40 p-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-0.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Tag className="h-3 w-3 text-primary" />
          Источник
        </span>

        {showLanding && (
          <a
            href={lead.landingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-secondary"
            title={`Страница с формой: ${lead.landingUrl}`}
          >
            <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{landingDomain}</span>
          </a>
        )}

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

        {entries.length === 0 && (
          <span
            className="inline-flex items-center rounded-md px-1 py-0.5 text-[10px] text-muted-foreground/70"
            title="Лид пришёл без utm_source/medium/campaign. Проверьте, что форма на сайте передаёт UTM-параметры из URL."
          >
            без UTM ⓘ
          </span>
        )}
      </div>
    </div>
  );
}
