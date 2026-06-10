import { useState } from "react";
import { Loader2, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isManualOverrideActive, manualValueForSave } from "@/lib/cdiManualOverride";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/components/metrics/metricsFormat";

export function ManualFactCell({
  title,
  icon: Icon,
  isoDate,
  value,
  crm,
  manual,
  manualRaw,
  autoLabel,
  onSave,
  disabled,
  format = formatNumber,
  allowDecimal,
}: {
  title: string;
  icon: React.ElementType;
  isoDate: string;
  value: number;
  crm: number;
  manual: number;
  manualRaw?: number | null;
  autoLabel: string;
  onSave: (newManual: number | null) => Promise<void>;
  disabled?: boolean;
  format?: (n: number) => string;
  allowDecimal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasManualOverride = isManualOverrideActive(manualRaw);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const auto = Math.max(0, crm);
  const hasValue = value > 0;

  const handleSave = async () => {
    const next = manualValueForSave(val);
    setSaving(true);
    try {
      await onSave(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await onSave(null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (disabled) {
    return (
      <span className="inline-flex w-full min-w-0 justify-end text-muted-foreground/40">
        {hasValue ? format(value) : "—"}
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setVal(hasManualOverride ? String(manualRaw ?? manual) : "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex w-full min-w-0 items-center justify-end gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-right transition-colors hover:border-primary/25 hover:bg-primary/5",
            !hasValue && "text-muted-foreground/50",
            hasManualOverride && "border-success/25 bg-success/5 font-semibold text-success",
          )}
          title={`${title}: ${isoDate}`}
        >
          <span className="tabular-nums">{hasValue ? format(value) : "—"}</span>
          <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 rounded-2xl border-border/70" align="end">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/10 text-success">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground">{isoDate}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-border/60 bg-card/60 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{autoLabel}</div>
              <div className="mt-1 text-sm font-bold tabular-nums">{format(auto)}</div>
            </div>
            <div className="rounded-xl border border-success/25 bg-success/10 p-2">
              <div className="text-[10px] uppercase tracking-wider text-success">Вручную</div>
              <div className="mt-1 text-sm font-bold tabular-nums text-success">{format(manual)}</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/60 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Показано</div>
              <div className="mt-1 text-sm font-bold tabular-nums">{format(value)}</div>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Ручное значение перезаписывает день. «Сбросить» — снова авто из CRM.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Ввести вручную</label>
            <Input
              type="number"
              min={0}
              step={allowDecimal ? "0.01" : "1"}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              placeholder="0"
              className="h-11 rounded-xl text-right text-base font-semibold tabular-nums"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => void handleReset()} disabled={saving}>
              Сбросить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button size="sm" className="gap-2" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Сохранить
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
