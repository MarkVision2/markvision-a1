import { Tag, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { siteDomain } from "@/lib/analyticsBreakdowns";
import { TEMPERATURE_LABEL, type LeadTemperature } from "@/lib/stageRoles";
import type { Lead, LeadChannel } from "@/types/crm";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { DeferredField } from "./DeferredField";

const CHANNELS: { id: LeadChannel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "instagram", label: "Инстаграм" },
  { id: "phone", label: "Звонок" },
  { id: "web", label: "Сайт" },
];

const SUGGESTED_TAGS = [
  "AI-Таргетолог",
  "Контент-завод",
  "Vibe Coding",
  "Кейс MarkVision AI",
  "Инстаграм",
  "Facebook",
  "Google",
  "YouTube",
  "Органика",
  "Знакомые",
  "База",
  "2ГИС",
];

interface Props {
  lead: Lead;
  onUpdate: (patch: Partial<Lead>) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function LeadProfileTab({ lead, onUpdate }: Props) {
  const utmEntries = lead.utm
    ? (Object.entries(lead.utm).filter(([, v]) => !!v) as Array<[string, string]>)
    : [];
  const [tagDraft, setTagDraft] = useState("");
  const tags = lead.tags ?? [];

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (tags.includes(t)) return;
    onUpdate({ tags: [...tags, t].slice(0, 30) });
    setTagDraft("");
  };

  const removeTag = (t: string) => {
    onUpdate({ tags: tags.filter((x) => x !== t) });
  };

  return (
    <div className="space-y-4">
      {/* Компания отдельно от контактного лица: раньше и то и другое приходилось
          писать в одно имя лида, в скобках. */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Компания</div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Название компании">
            <DeferredField
              key={`company-${lead.id}`}
              value={lead.companyName ?? ""}
              onCommit={(v) => {
                const next = v || undefined;
                if (next !== lead.companyName) onUpdate({ companyName: next });
              }}
              placeholder="ТОО «Пример»"
              ariaLabel="Название компании"
            />
          </Field>
          <Field label="Сфера деятельности">
            <DeferredField
              key={`industry-${lead.id}`}
              value={lead.industry ?? ""}
              onCommit={(v) => {
                const next = v || undefined;
                if (next !== lead.industry) onUpdate({ industry: next });
              }}
              placeholder="Строительство, IT, розница…"
              ariaLabel="Сфера деятельности"
            />
          </Field>
          <Field label="Контактное лицо (ФИО)">
            <DeferredField
              key={`contact-${lead.id}`}
              value={lead.contactPerson ?? ""}
              onCommit={(v) => {
                const next = v || undefined;
                if (next !== lead.contactPerson) onUpdate({ contactPerson: next });
              }}
              placeholder="Иванова Мария Петровна"
              ariaLabel="Контактное лицо"
            />
          </Field>
        </div>
        <div className="mt-3">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Запрос клиента</label>
          <DeferredField
            key={`request-${lead.id}`}
            multiline
            rows={3}
            value={lead.clientRequest ?? ""}
            onCommit={(v) => {
              const next = v || undefined;
              if (next !== lead.clientRequest) onUpdate({ clientRequest: next });
            }}
            placeholder="С чем клиент обратился"
            ariaLabel="Запрос клиента"
            className="mt-1"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Контакты</div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Телефон">
            <DeferredField
              key={`phone-${lead.id}`}
              value={lead.phone}
              onCommit={(v) => {
                if (v !== lead.phone) onUpdate({ phone: v });
              }}
              ariaLabel="Телефон"
            />
          </Field>
          <Field label="Email">
            <DeferredField
              key={`email-${lead.id}`}
              type="email"
              value={lead.email ?? ""}
              onCommit={(v) => {
                const next = v || undefined;
                if (next !== lead.email) onUpdate({ email: next });
              }}
              placeholder="—"
              ariaLabel="Email"
            />
          </Field>
          <Field label="Город">
            <DeferredField
              key={`city-${lead.id}`}
              value={lead.city ?? ""}
              onCommit={(v) => {
                const next = v || undefined;
                if (next !== lead.city) onUpdate({ city: next });
              }}
              placeholder="Алматы"
              ariaLabel="Город"
            />
          </Field>
          <Field label="Возраст">
            <DeferredField
              key={`age-${lead.id}`}
              digitsOnly
              inputMode="numeric"
              value={lead.age != null ? String(lead.age) : ""}
              onCommit={(digits) => {
                const n = digits ? Number(digits) : NaN;
                const next = Number.isFinite(n) && n > 0 ? n : undefined;
                if (next !== lead.age) onUpdate({ age: next });
              }}
              placeholder="—"
              maxLength={3}
              ariaLabel="Возраст"
            />
          </Field>
          <Field label="Канал">
            <Select
              value={lead.channel ?? "whatsapp"}
              onValueChange={(v) => onUpdate({ channel: v as LeadChannel })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Температура">
            <Select
              value={lead.temperature ?? "none"}
              onValueChange={(v) =>
                onUpdate({ temperature: v === "none" ? undefined : (v as LeadTemperature) })
              }
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Не задана</SelectItem>
                {(Object.keys(TEMPERATURE_LABEL) as LeadTemperature[]).map((k) => (
                  <SelectItem key={k} value={k}>{TEMPERATURE_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="mt-3 grid gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Комментарий</label>
          <DeferredField
            key={`note-${lead.id}`}
            multiline
            value={lead.note ?? ""}
            onCommit={(v) => {
              const next = v || undefined;
              if (next !== lead.note) onUpdate({ note: next });
            }}
            rows={3}
            maxLength={500}
            ariaLabel="Комментарий"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Теги</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => removeTag(t)}
              className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[11px] font-medium hover:bg-destructive/15"
              title="Удалить тег"
            >
              {t} ×
            </button>
          ))}
          {tags.length === 0 && (
            <span className="text-[11px] text-muted-foreground">Пока нет тегов</span>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(tagDraft);
              }
            }}
            placeholder="Новый тег…"
            className="h-8 text-xs"
          />
          <button
            type="button"
            onClick={() => addTag(tagDraft)}
            className="rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground"
          >
            +
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).slice(0, 8).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addTag(t)}
              className={cn(
                "rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              + {t}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Tag className="h-3.5 w-3.5 text-primary" /> Источник трафика и UTM
        </div>
        {utmEntries.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {utmEntries.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5 text-xs">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">utm_{k}</span>
                <span className="truncate font-semibold">{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-[11px] text-muted-foreground">UTM-метки не зафиксированы</div>
        )}
        {lead.landingUrl && (() => {
          const landingDomain = siteDomain(lead.landingUrl);
          if (landingDomain === "Сайт не определён") return null;
          return (
            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2 text-[11px]">
              <div className="flex items-start gap-1.5 text-muted-foreground">
                <Globe className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="truncate">
                  Сайт:{" "}
                  <a
                    href={lead.landingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-foreground hover:underline"
                    title={lead.landingUrl}
                  >
                    {landingDomain}
                  </a>
                </span>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
