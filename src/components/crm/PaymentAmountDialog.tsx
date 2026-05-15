import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Wallet, CreditCard, Banknote, Smartphone, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types/crm";

const METHODS: { id: PaymentMethod; label: string; icon: typeof Wallet }[] = [
  { id: "kaspi", label: "Kaspi", icon: Smartphone },
  { id: "card", label: "Карта", icon: CreditCard },
  { id: "cash", label: "Наличные", icon: Banknote },
  { id: "transfer", label: "Перевод", icon: ArrowRightLeft },
];

interface Props {
  open: boolean;
  /** Сумма из карточки лида (используется как подсказка). */
  defaultAmount?: number;
  /** Если задан — будет показан как hint в текстовом поле «назначение». */
  defaultNote?: string;
  onConfirm: (method: PaymentMethod, amount: number, opts?: { note?: string }) => void;
  /** Закрытие без подтверждения. Этап НЕ должен переключиться на «Оплачен», если оплата не введена. */
  onCancel: () => void;
  onOpenChange: (v: boolean) => void;
}

export function PaymentAmountDialog({
  open, defaultAmount, defaultNote, onConfirm, onCancel, onOpenChange,
}: Props) {
  const [method, setMethod] = useState<PaymentMethod>("kaspi");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setMethod("kaspi");
      setDraft(defaultAmount && defaultAmount > 0 ? String(defaultAmount) : "");
      setNote(defaultNote ?? "");
    }
  }, [open, defaultAmount, defaultNote]);

  const amount = Number(draft);
  const canSubmit = Number.isFinite(amount) && amount > 0;

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      // Закрытие без сохранения — отменяем перевод этапа.
      onCancel();
    }
    onOpenChange(v);
  };

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(method, amount, note.trim() ? { note: note.trim() } : undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Введите сумму оплаты</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Сделка переводится в этап «Оплачен». Сумма обязательна — она попадёт в аналитику и
          в выручку проекта.
        </p>

        <div className="mt-2 grid gap-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Сумма, $ <span className="text-destructive">*</span>
          </Label>
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
            inputMode="numeric"
            placeholder="0"
            className={cn(!canSubmit && draft.length > 0 && "border-destructive focus-visible:ring-destructive")}
          />

          <Label className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Способ оплаты</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const active = method === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:bg-secondary/60",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <Label className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Комментарий (необязательно)
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="например, предоплата 50%"
            rows={2}
            className="text-sm"
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {!canSubmit ? "Укажите сумму больше нуля" : " "}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => { onCancel(); onOpenChange(false); }}
            >
              Отмена
            </Button>
            <Button
              onClick={submit}
              disabled={!canSubmit}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              <Wallet className="h-4 w-4" /> Подтвердить оплату
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
