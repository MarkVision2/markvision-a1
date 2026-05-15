import { Phone, MessageSquare, Calendar, Wallet, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead, PaymentMethod } from "@/types/crm";
import { leadSlaMinutes } from "@/hooks/useCrmAnalytics";
import { PaymentPopover } from "./PaymentPopover";
import { VisitSlotPopover } from "./VisitSlotPopover";
import { CallDialPopover, type CallResult } from "./CallDialPopover";
import { WriteWhatsAppPopover } from "./WriteWhatsAppPopover";

interface Props {
  lead: Lead;
  onCall: (opts?: { direction?: "outgoing" | "incoming"; status?: "answered" | "missed"; durationSec?: number; note?: string }) => void;
  onCallAttempt?: (info: { provider: string; ok: boolean; phone?: string; warning?: string; error?: string }) => void;
  onWrite: () => void;
  /** Optional — log the sent template/text into the chat history. */
  onWriteTemplate?: (text: string, templateKey?: string) => void;
  onScheduleVisit: (iso: string) => void;
  onMarkPaid: (method: PaymentMethod, amount: number, opts?: { note?: string }) => void;
  onClose: () => void;
  /** Other leads' booked visits (ISO timestamps) — used to mark slots as busy. */
  busySlots?: { iso: string; leadName?: string }[];
}

/**
 * Одна action-кнопка фиксированной ширины с иконкой и подписью.
 * Используется и сама по себе (onClick), и как `asChild` триггер для Popover.
 */
function ActionButton({
  icon: Icon,
  label,
  onClick,
  tone = "neutral",
  asChild,
}: {
  icon: typeof Phone;
  label: string;
  onClick?: () => void;
  tone?: "neutral" | "danger";
  asChild?: boolean;
}) {
  const className = cn(
    "flex h-full w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-elevated",
    tone === "danger"
      ? "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10"
      : "border-border/70 bg-secondary/50 text-foreground hover:bg-secondary",
  );
  if (asChild) {
    return (
      <span className={className}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function LeadActionPanel({
  lead, onCall, onCallAttempt, onWrite, onWriteTemplate, onScheduleVisit, onMarkPaid, onClose, busySlots,
}: Props) {
  const sla = leadSlaMinutes(lead);
  const slaHint = sla > 5 && !lead.firstResponseAt ? `Связаться немедленно — ждёт ${sla} мин` : null;

  return (
    <div className="border-b border-border/60 bg-background py-3">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        <CallDialPopover
          phone={lead.phone}
          leadId={lead.id}
          onConfirm={(r: CallResult) => onCall(r)}
          onAttempt={onCallAttempt}
          trigger={<ActionButton icon={Phone} label="Позвонить" asChild />}
        />
        <WriteWhatsAppPopover
          lead={lead}
          onSent={(text, key) => {
            if (text && onWriteTemplate) onWriteTemplate(text, key);
            onWrite();
          }}
          trigger={<ActionButton icon={MessageSquare} label="Написать" asChild />}
        />
        <VisitSlotPopover
          current={lead.nextVisitAt}
          busy={busySlots}
          onConfirm={onScheduleVisit}
          trigger={<ActionButton icon={Calendar} label="Визит" asChild />}
        />
        <PaymentPopover
          amount={lead.amount}
          defaultNote={lead.service}
          onConfirm={(method, amount, opts) => onMarkPaid(method, amount, opts)}
          trigger={<ActionButton icon={Wallet} label="Оплата" asChild />}
        />
        <ActionButton icon={XCircle} label="Отказ" tone="danger" onClick={onClose} />
      </div>

      {slaHint && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">{slaHint}</span>
        </div>
      )}
    </div>
  );
}
