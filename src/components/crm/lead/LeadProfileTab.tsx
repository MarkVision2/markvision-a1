import { Tag, Globe, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Lead, LeadChannel } from "@/types/crm";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const CHANNELS: { id: LeadChannel; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "instagram", label: "Instagram" },
  { id: "phone", label: "Звонок" },
  { id: "web", label: "Сайт" },
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

  return (
    <div className="space-y-4">
      {/* Контакты */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Контакты</div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Телефон">
            <Input value={lead.phone} onChange={(e) => onUpdate({ phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={lead.email ?? ""}
              onChange={(e) => onUpdate({ email: e.target.value || undefined })}
              placeholder="—"
            />
          </Field>
          <Field label="Город">
            <Input
              value={lead.city ?? ""}
              onChange={(e) => onUpdate({ city: e.target.value || undefined })}
              placeholder="Алматы"
            />
          </Field>
          <Field label="Возраст">
            <Input
              type="number"
              value={lead.age ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                onUpdate({ age: Number.isFinite(n) && n > 0 ? n : undefined });
              }}
              placeholder="—"
              min={0}
              max={120}
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
        </div>

        <div className="mt-3 grid gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Комментарий</label>
          <Textarea
            value={lead.note ?? ""}
            onChange={(e) => onUpdate({ note: e.target.value || undefined })}
            rows={3}
            maxLength={500}
          />
        </div>
      </div>

      {/* Источник трафика */}
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
        {(lead.referrer || lead.landingUrl) && (
          <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2 text-[11px]">
            {lead.landingUrl && (
              <div className="flex items-start gap-1.5 text-muted-foreground">
                <Globe className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="truncate">
                  Landing:{" "}
                  <a href={lead.landingUrl} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
                    {lead.landingUrl}
                  </a>
                </span>
              </div>
            )}
            {lead.referrer && (
              <div className="flex items-start gap-1.5 text-muted-foreground">
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="truncate">Referrer: <span className="text-foreground">{lead.referrer}</span></span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}