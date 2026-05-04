import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
  amount: number;
  defaultNote?: string;
  onConfirm: (method: PaymentMethod, amount: number, opts?: { note?: string }) => void;
  trigger: React.ReactNode;
}

export function PaymentPopover({ amount, defaultNote, onConfirm, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("kaspi");
  const [draft, setDraft] = useState(String(amount || ""));
  const [note, setNote] = useState(defaultNote ?? "");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="text-sm font-semibold">Отметить оплату</div>
        <div className="mt-3 grid gap-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Сумма, $</Label>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="0"
          />
          <Label className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Способ</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const active = method === m.id;
              return (
                <button
                  key={m.id}
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
          <Label className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Назначение / услуга</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="например, Консультация + чистка"
            rows={2}
            className="text-sm"
          />
          <Button
            onClick={() => {
              onConfirm(method, Number(draft) || 0, note.trim() ? { note: note.trim() } : undefined);
              setOpen(false);
            }}
            disabled={!Number(draft)}
            className="mt-2 bg-success text-success-foreground hover:bg-success/90"
          >
            <Wallet className="h-4 w-4" />Подтвердить оплату
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}