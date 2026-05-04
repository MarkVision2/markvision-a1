import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { REJECT_REASONS, type RejectReason } from "@/types/crm";
import { cn } from "@/lib/utils";
import { XCircle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (r: RejectReason, note?: string) => void;
  /** Если true — закрыть без выбора причины нельзя (нет «Отмена», Esc/overlay блокируются). По умолчанию true. */
  required?: boolean;
  /** Если true — показываем «Отмена», вызывающую onCancel. Игнорируется когда required=true и onCancel не задан. */
  allowCancel?: boolean;
  onCancel?: () => void;
}

const NOTE_LIMIT = 280;

export function RejectReasonDialog({ open, onOpenChange, onPick, required = true, allowCancel = false, onCancel }: Props) {
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReason(null);
      setNote("");
    }
  }, [open]);

  const requireNote = reason === "other";
  const noteMissing = requireNote && note.trim().length === 0;
  const canSubmit = !!reason && !noteMissing;
  const showCancel = allowCancel && !!onCancel;

  const handleOpenChange = (v: boolean) => {
    if (!v && required && !showCancel) {
      // блокируем закрытие без выбора причины
      return;
    }
    if (!v && showCancel) {
      onCancel?.();
    }
    onOpenChange(v);
  };

  const submit = () => {
    if (!reason || !canSubmit) return;
    onPick(reason, note.trim() || undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[460px]"
        onEscapeKeyDown={(e) => { if (required && !showCancel) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (required && !showCancel) e.preventDefault(); }}
        onInteractOutside={(e) => { if (required && !showCancel) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Закрыть как отказ</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Причина обязательна — это поможет понять, где вы теряете деньги, и улучшить связку реклама → продажа.
        </p>

        <Label className="mt-1 block text-[11px] uppercase tracking-wide text-muted-foreground">Причина</Label>
        <div className="mt-1 grid grid-cols-1 gap-1.5">
          {REJECT_REASONS.map((r) => {
            const active = reason === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setReason(r.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 bg-card/60 hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                <span className="text-lg">{r.emoji}</span>
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          <Label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
            Комментарий {requireNote && <span className="text-destructive">*</span>}
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_LIMIT))}
            placeholder={requireNote ? "Опишите причину…" : "Что именно сказал клиент (необязательно)"}
            rows={3}
            className={cn("text-sm", noteMissing && "border-destructive focus-visible:ring-destructive")}
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">
            {note.length} / {NOTE_LIMIT}
          </div>
          {noteMissing && (
            <p className="text-[11px] text-destructive">Для причины «Другое» комментарий обязателен.</p>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {!reason ? "Выберите причину, чтобы продолжить" : "\u00A0"}
          </p>
          <div className="flex items-center gap-2">
            {showCancel && (
              <Button variant="outline" onClick={() => { onCancel?.(); onOpenChange(false); }}>Отмена</Button>
            )}
            <Button
            onClick={submit}
            disabled={!canSubmit}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            <XCircle className="h-4 w-4" /> Закрыть как отказ
          </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}