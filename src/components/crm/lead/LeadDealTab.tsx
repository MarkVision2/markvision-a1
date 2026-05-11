import { Calendar, Stethoscope, CreditCard } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Lead, PaymentMethod } from "@/types/crm";

const SERVICES = ["Имплант", "Чистка", "Консультация", "Отбеливание", "Брекеты", "Удаление", "Лечение"];
const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "kaspi", label: "Kaspi" },
  { id: "card", label: "Карта" },
  { id: "cash", label: "Наличные" },
  { id: "transfer", label: "Перевод" },
];

function toLocalInputValue(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  lead: Lead;
  onUpdate: (patch: Partial<Lead>) => void;
}

export function LeadDealTab({ lead, onUpdate }: Props) {
  return (
    <div className="space-y-3">
      {/* Услуга и визит */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Stethoscope className="h-3.5 w-3.5 text-primary" /> Услуга
          </div>
          <Input
            list="lead-services"
            value={lead.service ?? ""}
            onChange={(e) => onUpdate({ service: e.target.value || undefined })}
            placeholder="например, Имплант"
            className="mt-2"
          />
          <datalist id="lead-services">
            {SERVICES.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 text-warning" /> Планируемый визит
          </div>
          <Input
            type="datetime-local"
            value={toLocalInputValue(lead.nextVisitAt)}
            onChange={(e) => onUpdate({ nextVisitAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
            className="mt-2"
          />
          {lead.nextVisitAt && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {new Date(lead.nextVisitAt).toLocaleString("ru-RU")}
            </div>
          )}
        </div>
      </div>

      {/* Оплата */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <CreditCard className="h-3.5 w-3.5 text-success" /> Оплата
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{lead.paid ? "оплачено" : "не оплачено"}</span>
            <Switch
              checked={!!lead.paid}
              onCheckedChange={(v) =>
                onUpdate({
                  paid: v,
                  paidAt: v ? (lead.paidAt ?? new Date().toISOString()) : undefined,
                })
              }
            />
          </div>
        </div>
        {lead.paid && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Способ</label>
              <Select
                value={lead.paymentMethod ?? "kaspi"}
                onValueChange={(v) => onUpdate({ paymentMethod: v as PaymentMethod })}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Дата оплаты</label>
              <Input
                type="datetime-local"
                value={toLocalInputValue(lead.paidAt)}
                onChange={(e) => onUpdate({ paidAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                className="mt-1"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
