import { Phone, MessageSquare, Calendar, Wallet, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import { leadSlaMinutes } from "@/hooks/useCrmAnalytics";
import { PaymentPopover } from "./PaymentPopover";
import { VisitSlotPopover } from "./VisitSlotPopover";
import { CallDialPopover, type CallResult } from "./CallDialPopover";
import { WriteWhatsAppPopover } from "./WriteWhatsAppPopover";
import type { PaymentMethod } from "@/types/crm";

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

export function LeadActionPanel({
  lead, onCall, onCallAttempt, onWrite, onWriteTemplate, onScheduleVisit, onMarkPaid, onClose, busySlots,
}: Props) {
  const sla = leadSlaMinutes(lead);
  const slaHint = sla > 5 && !lead.firstResponseAt ? `Связаться немедленно — ждёт ${sla} мин` : null;

  const Btn = ({
    icon: Icon, label, onClick, className, asChild,
  }: {
    icon: typeof Phone; label: string; onClick?: () => void; className?: string; asChild?: boolean;
  }) => {
    const inner = (
      <span className={cn(
        "flex shrink-0 flex-col items-center gap-1 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-elevated sm:flex-row sm:gap-1.5 sm:px-3.5",
        className,
      )}>
        <Icon className="h-4 w-4" />
        {label}
      </span>
    );
    if (asChild) return inner;
    return <button type="button" onClick={onClick} className="contents">{inner}</button>;
  };

  return (
    <div className="border-b border-border/60 bg-background py-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <CallDialPopover
          phone={lead.phone}
          leadId={lead.id}
          onConfirm={(r: CallResult) => onCall(r)}
          onAttempt={onCallAttempt}
          trigger={
            <button type="button" className="contents">
              <Btn icon={Phone} label="Позвонить" asChild
                className="border-border/70 bg-secondary/50 text-foreground hover:bg-secondary" />
            </button>
          }
        />
        <WriteWhatsAppPopover
          lead={lead}
          onSent={(text, key) => {
            if (text && onWriteTemplate) onWriteTemplate(text, key);
            onWrite();
          }}
          trigger={
            <button type="button" className="contents">
              <Btn icon={MessageSquare} label="Написать" asChild
                className="border-border/70 bg-secondary/50 text-foreground hover:bg-secondary" />
            </button>
          }
        />
        <VisitSlotPopover
          current={lead.nextVisitAt}
          busy={busySlots}
          onConfirm={onScheduleVisit}
          trigger={
            <button type="button" className="contents">
              <Btn icon={Calendar} label="Записать на визит" asChild
                className="border-border/70 bg-secondary/50 text-foreground hover:bg-secondary" />
            </button>
          }
        />
        <PaymentPopover
          amount={lead.amount}
          defaultNote={lead.service}
          onConfirm={(method, amount, opts) => onMarkPaid(method, amount, opts)}
          trigger={
            <button type="button" className="contents">
              <Btn icon={Wallet} label="Отметить оплату" asChild
                className="border-border/70 bg-secondary/50 text-foreground hover:bg-secondary" />
            </button>
          }
        />
        <Btn icon={XCircle} label="Закрыть" onClick={onClose}
          className="border-border/70 bg-secondary/50 text-foreground hover:bg-secondary" />
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