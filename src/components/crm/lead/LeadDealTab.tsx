import { useEffect, useState } from "react";
import { Calendar, Megaphone, CreditCard, Wallet, ArrowRightCircle, Layers } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage, PaymentMethod } from "@/types/crm";

const SOURCE_PRESETS: { id: string; label: string }[] = [
  { id: "meta", label: "Meta" },
  { id: "google", label: "Google" },
  { id: "tiktok", label: "TikTok" },
  { id: "sarafan", label: "Сарафан" },
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
}

export function LeadDealTab({ lead, stages, onUpdate, onChangeStage }: Props) {
  const sourceKey = (lead.source ?? "").toLowerCase();
  const activePreset = PRESET_IDS.has(sourceKey) ? sourceKey : null;

  const [pendingStage, setPendingStage] = useState<string>(lead.stageId);
  useEffect(() => { setPendingStage(lead.stageId); }, [lead.stageId, lead.id]);

  return (
    <div className="space-y-3">
      {/* Этап сделки */}
      {stages && stages.length > 0 && onChangeStage && (
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Layers className="h-3.5 w-3.5 text-primary" /> Этап сделки
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Select value={pendingStage} onValueChange={setPendingStage}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
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
              className="gap-1"
            >
              <ArrowRightCircle className="h-4 w-4" />
              Перенести
            </Button>
          </div>
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            Текущий: <span className="font-semibold text-foreground/80">{stages.find((s) => s.id === lead.stageId)?.title ?? lead.stageId}</span>
          </div>
        </div>
      )}


      {/* Сумма сделки */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Wallet className="h-3.5 w-3.5 text-primary" /> Сумма сделки
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <Input
            type="text"
            inputMode="numeric"
            value={lead.amount ? String(lead.amount) : ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "");
              onUpdate({ amount: digits ? Number(digits) : 0 });
            }}
            placeholder="0"
            className="text-xl font-bold"
            aria-label="Сумма сделки"
          />
          <span className="text-xs text-muted-foreground">$</span>
        </div>
      </div>

      {/* Источник и визит */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Megaphone className="h-3.5 w-3.5 text-primary" /> Источник
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {SOURCE_PRESETS.map((s) => {
              const active = activePreset === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onUpdate({ source: s.id })}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/60 bg-card/40 hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {!activePreset && lead.source && (
            <div className="mt-2 text-[10px] text-muted-foreground">
              Текущий источник: <span className="font-mono text-foreground/80">{lead.source}</span>
              <span className="ml-1 text-muted-foreground/70">(из UTM — выберите вручную, чтобы перезаписать)</span>
            </div>
          )}
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
