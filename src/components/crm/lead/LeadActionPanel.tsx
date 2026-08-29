import { forwardRef } from "react";
import { Phone, Calendar, Wallet, XCircle, AlertTriangle, MessageCircle } from "lucide-react";
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
  onScheduleVisit: (iso: string) => void;
  onMarkPaid: (method: PaymentMethod, amount: number, opts?: { note?: string }) => void;
  onClose: () => void;
  /** Called after a WhatsApp message is launched, so the parent can log it in the chat. */
  onWrite?: (text: string, templateKey?: string) => void;
  /** Other leads' booked visits (ISO timestamps) — used to mark slots as busy. */
  busySlots?: { iso: string; leadName?: string }[];
}

interface ActionButtonProps {
  icon: typeof Phone;
  label: string;
  tone?: "neutral" | "danger";
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

/**
 * Action-кнопка фиксированной ширины. Всегда нативный <button>, чтобы
 * Radix PopoverTrigger asChild клонировал её корректно (со span клик не
 * прорастал в попап, и тогда кнопки выглядели «мёртвыми»).
 */
const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps & React.ComponentPropsWithoutRef<"button">>(
  function ActionButton({ icon: Icon, label, tone = "neutral", className, onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        {...rest}
        className={cn(
          "flex min-h-[4.5rem] h-full w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 text-[11px] font-medium transition-colors",
          tone === "danger"
            ? "bg-destructive/8 text-destructive ring-1 ring-destructive/25 hover:bg-destructive/15"
            : "bg-secondary/40 text-foreground ring-1 ring-border/40 hover:bg-secondary/70 hover:ring-border/60",
          className,
        )}
      >
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-xl",
            tone === "danger" ? "bg-destructive/10" : "bg-background/50",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
        </span>
        <span className="truncate">{label}</span>
      </button>
    );
  },
);

export function LeadActionPanel({
  lead, onCall, onCallAttempt, onScheduleVisit, onMarkPaid, onClose, onWrite, busySlots,
}: Props) {
  const sla = leadSlaMinutes(lead);
  const slaHint = sla > 5 && !lead.firstResponseAt ? `Связаться немедленно — ждёт ${sla} мин` : null;

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <CallDialPopover
          phone={lead.phone}
          leadId={lead.id}
          projectId={lead.projectId}
          onConfirm={(r: CallResult) => onCall(r)}
          onAttempt={onCallAttempt}
          trigger={<ActionButton icon={Phone} label="Позвонить" />}
        />
        <WriteWhatsAppPopover
          lead={lead}
          onSent={onWrite}
          trigger={<ActionButton icon={MessageCircle} label="Написать" />}
        />
        <VisitSlotPopover
          current={lead.nextVisitAt}
          busy={busySlots}
          onConfirm={onScheduleVisit}
          trigger={<ActionButton icon={Calendar} label="Визит" />}
        />
        <PaymentPopover
          amount={lead.amount}
          defaultNote={lead.service}
          onConfirm={(method, amount, opts) => onMarkPaid(method, amount, opts)}
          trigger={<ActionButton icon={Wallet} label="Оплата" />}
        />
        <ActionButton icon={XCircle} label="Отказ" tone="danger" onClick={onClose} />
      </div>

      {slaHint && (
        <div className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-[11px] text-destructive ring-1 ring-destructive/25">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">{slaHint}</span>
        </div>
      )}
    </div>
  );
}
