import { forwardRef } from "react";
import { Phone, Calendar, Wallet, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead, PaymentMethod } from "@/types/crm";
import { leadSlaMinutes } from "@/hooks/useCrmAnalytics";
import { PaymentPopover } from "./PaymentPopover";
import { VisitSlotPopover } from "./VisitSlotPopover";
import { CallDialPopover, type CallResult } from "./CallDialPopover";

interface Props {
  lead: Lead;
  onCall: (opts?: { direction?: "outgoing" | "incoming"; status?: "answered" | "missed"; durationSec?: number; note?: string }) => void;
  onCallAttempt?: (info: { provider: string; ok: boolean; phone?: string; warning?: string; error?: string }) => void;
  onScheduleVisit: (iso: string) => void;
  onMarkPaid: (method: PaymentMethod, amount: number, opts?: { note?: string }) => void;
  onClose: () => void;
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
          "flex h-full w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-elevated",
          tone === "danger"
            ? "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10"
            : "border-border/70 bg-secondary/50 text-foreground hover:bg-secondary",
          className,
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    );
  },
);

export function LeadActionPanel({
  lead, onCall, onCallAttempt, onScheduleVisit, onMarkPaid, onClose, busySlots,
}: Props) {
  const sla = leadSlaMinutes(lead);
  const slaHint = sla > 5 && !lead.firstResponseAt ? `Связаться немедленно — ждёт ${sla} мин` : null;

  return (
    <div className="border-b border-border/60 bg-background py-3">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <CallDialPopover
          phone={lead.phone}
          leadId={lead.id}
          onConfirm={(r: CallResult) => onCall(r)}
          onAttempt={onCallAttempt}
          trigger={<ActionButton icon={Phone} label="Позвонить" />}
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
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">{slaHint}</span>
        </div>
      )}
    </div>
  );
}
