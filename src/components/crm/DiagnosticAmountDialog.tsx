import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Stethoscope, Gift } from "lucide-react";

interface Props {
  open: boolean;
  defaultAmount?: number;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
  onOpenChange: (v: boolean) => void;
}

export function DiagnosticAmountDialog({
  open, defaultAmount, onConfirm, onCancel, onOpenChange,
}: Props) {
  const [free, setFree] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open) {
      const init = defaultAmount ?? 0;
      setFree(init === 0);
      setDraft(init > 0 ? String(init) : "");
    }
  }, [open, defaultAmount]);

  const amount = free ? 0 : Number(draft) || 0;
  const canSubmit = free || (Number.isFinite(amount) && amount >= 0);

  const handleOpenChange = (v: boolean) => {
    if (!v) onCancel();
    onOpenChange(v);
  };

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(amount);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-primary" />
            Стоимость диагностики
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Клиент записан на диагностику. Укажи её цену — она попадёт в аналитику кабинета
          (+1 диагностика и выручка за диагностику). Если бесплатная — включи переключатель.
        </p>

        <div className="mt-2 grid gap-3">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Gift className="h-4 w-4 text-success" />
              Бесплатная диагностика
            </div>
            <Switch checked={free} onCheckedChange={setFree} />
          </div>

          {!free && (
            <div className="grid gap-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Сумма, $
              </Label>
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
                inputMode="numeric"
                placeholder="0"
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => { onCancel(); onOpenChange(false); }}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Stethoscope className="h-4 w-4" /> Зафиксировать
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
