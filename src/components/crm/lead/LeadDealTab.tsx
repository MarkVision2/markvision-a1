import { useEffect, useState, type ReactNode } from "react";
import { Calendar, Megaphone, CreditCard, Wallet, ArrowRight, Layers, X, type LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage, PaymentMethod } from "@/types/crm";
import { VisitSlotPopover } from "./VisitSlotPopover";

const SOURCE_PRESETS: { id: string; label: string }[] = [
  { id: "instagram", label: "Инстаграм" },
  { id: "friends", label: "Знакомые" },
  { id: "base", label: "База" },
  { id: "2gis", label: "2ГИС" },
];
const PRESET_IDS = new Set(SOURCE_PRESETS.map((s) => s.id));

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
  stages?: LeadStage[];
  onUpdate: (patch: Partial<Lead>) => void;
  onChangeStage?: (stageId: string) => void;
  onScheduleVisit?: (iso: string) => void;
  busySlots?: { iso: string; leadName?: string }[];
}

function FieldLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary/80" />
      <span>{children}</span>
    </div>
  );
}

function formatVisitLabel(iso?: string) {
  if (!iso) return "Выбрать дату и время";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Выбрать дату и время";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LeadDealTab({ lead, stages, onUpdate, onChangeStage, onScheduleVisit, busySlots }: Props) {
  const sourceKey = (lead.source ?? "").toLowerCase();
  const activePreset = PRESET_IDS.has(sourceKey) ? sourceKey : null;

  const [pendingStage, setPendingStage] = useState<string>(lead.stageId);
  useEffect(() => { setPendingStage(lead.stageId); }, [lead.stageId, lead.id]);

  return (
    <div className="overflow-hidden rounded-2xl bg-secondary/25 ring-1 ring-border/40">
      {/* Этап сделки */}
      {stages && stages.length > 0 && onChangeStage && (
        <div className="border-b border-border/40 px-3.5 py-3.5">
          <FieldLabel icon={Layers}>Этап сделки</FieldLabel>
          <div className="flex items-center gap-2">
            <Select value={pendingStage} onValueChange={setPendingStage}>
              <SelectTrigger className="h-10 flex-1 rounded-xl border-border/50 bg-background/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={() => onChangeStage(pendingStage)}
              disabled={pendingStage === lead.stageId}
              className="h-10 gap-1.5 rounded-xl px-3"
            >
              <ArrowRight className="h-4 w-4" />
              Перенести
            </Button>
          </div>
        </div>
      )}

      {/* Сумма */}
      <div className="border-b border-border/40 px-3.5 py-3.5">
        <FieldLabel icon={Wallet}>Сумма сделки</FieldLabel>
        <div className="relative">
          <Input
            type="text"
            inputMode="numeric"
            value={lead.amount ? String(lead.amount) : ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "");
              onUpdate({ amount: digits ? Number(digits) : 0 });
            }}
            placeholder="0"
            className="h-11 rounded-xl border-border/50 bg-background/40 pr-10 text-lg font-semibold tabular-nums"
            aria-label="Сумма сделки"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            ₸
          </span>
        </div>
      </div>

      {/* Источник */}
      <div className="border-b border-border/40 px-3.5 py-3.5">
        <FieldLabel icon={Megaphone}>Источник</FieldLabel>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {SOURCE_PRESETS.map((s) => {
            const active = activePreset === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onUpdate({ source: s.id })}
                className={cn(
                  "rounded-xl px-2 py-2 text-xs font-medium transition-colors ring-1",
                  active
                    ? "bg-primary/15 text-primary ring-primary/35"
                    : "bg-background/30 text-foreground/80 ring-border/40 hover:bg-background/50 hover:ring-border/60",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {!activePreset && lead.source && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Сейчас: <span className="font-medium text-foreground/80">{lead.source}</span>
            <span className="text-muted-foreground/70"> — выберите канал выше, чтобы перезаписать</span>
          </div>
        )}
      </div>

      {/* Визит */}
      <div className="border-b border-border/40 px-3.5 py-3.5">
        <FieldLabel icon={Calendar}>Планируемый визит</FieldLabel>
        <div className="flex items-center gap-2">
          <VisitSlotPopover
            current={lead.nextVisitAt}
            busy={busySlots}
            onConfirm={(iso) => {
              if (onScheduleVisit) {
                onScheduleVisit(iso);
              } else {
                onUpdate({ nextVisitAt: iso });
              }
            }}
            trigger={
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-11 min-w-0 flex-1 justify-start rounded-xl border-border/50 bg-background/40 px-3 text-left font-medium",
                  !lead.nextVisitAt && "text-muted-foreground",
                )}
              >
                <Calendar className="h-4 w-4 shrink-0 text-primary/80" />
                <span className="min-w-0 truncate">{formatVisitLabel(lead.nextVisitAt)}</span>
              </Button>
            }
          />
          {lead.nextVisitAt && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Убрать визит"
              aria-label="Убрать планируемый визит"
              onClick={() => onUpdate({ nextVisitAt: undefined })}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        {lead.nextVisitAt && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Записан на {new Date(lead.nextVisitAt).toLocaleString("ru-RU")}
          </div>
        )}
      </div>

      {/* Оплата */}
      <div className="px-3.5 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel icon={CreditCard}>Оплата</FieldLabel>
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className={cn("font-medium", lead.paid ? "text-success" : "text-muted-foreground")}>
              {lead.paid ? "оплачено" : "не оплачено"}
            </span>
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
          <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Способ</label>
              <Select
                value={lead.paymentMethod ?? "kaspi"}
                onValueChange={(v) => onUpdate({ paymentMethod: v as PaymentMethod })}
              >
                <SelectTrigger className="mt-1 h-10 rounded-xl border-border/50 bg-background/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Дата оплаты</label>
              <Input
                type="datetime-local"
                value={toLocalInputValue(lead.paidAt)}
                onChange={(e) => onUpdate({ paidAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                className="mt-1 h-10 rounded-xl border-border/50 bg-background/40"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
