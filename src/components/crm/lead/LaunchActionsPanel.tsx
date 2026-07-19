import { CalendarCheck, Flame, HandCoins, GraduationCap, MessageCircle, Phone, Send, UserCheck, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";

type LaunchAction =
  | "whatsapp"
  | "warming"
  | "confirmed"
  | "webinar_attended"
  | "webinar_late"
  | "webinar_no_show"
  | "interest"
  | "call_scheduled"
  | "call_done"
  | "offer"
  | "deposit"
  | "paid"
  | "student";

interface Props {
  lead: Lead;
  onAction: (action: LaunchAction, opts?: { amount?: number }) => void;
}

const BTN =
  "inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 px-2 py-1.5 text-[11px] font-semibold transition hover:bg-secondary disabled:opacity-50";

export function LaunchActionsPanel({ lead, onAction }: Props) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Действия запуска
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={BTN} onClick={() => onAction("whatsapp")}>
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
        </button>
        <button type="button" className={BTN} onClick={() => onAction("warming")}>
          Прогрев
        </button>
        <button type="button" className={BTN} onClick={() => onAction("confirmed")}>
          <UserCheck className="h-3.5 w-3.5" /> Подтвердил
        </button>
        <button type="button" className={cn(BTN, "border-success/40 text-success")} onClick={() => onAction("webinar_attended")}>
          <Video className="h-3.5 w-3.5" /> Пришёл
        </button>
        <button type="button" className={BTN} onClick={() => onAction("webinar_late")}>
          Опоздал
        </button>
        <button type="button" className={cn(BTN, "border-destructive/40 text-destructive")} onClick={() => onAction("webinar_no_show")}>
          Не пришёл
        </button>
        <button type="button" className={cn(BTN, "border-warning/40 text-warning")} onClick={() => onAction("interest")}>
          <Flame className="h-3.5 w-3.5" /> Интерес
        </button>
        <button type="button" className={BTN} onClick={() => onAction("call_scheduled")}>
          <CalendarCheck className="h-3.5 w-3.5" /> Созвон
        </button>
        <button type="button" className={BTN} onClick={() => onAction("call_done")}>
          <Phone className="h-3.5 w-3.5" /> Созвон ✓
        </button>
        <button type="button" className={BTN} onClick={() => onAction("offer")}>
          <Send className="h-3.5 w-3.5" /> КП
        </button>
        <button type="button" className={cn(BTN, "border-success/40 text-success")} onClick={() => onAction("deposit", { amount: 10000 })}>
          <HandCoins className="h-3.5 w-3.5" /> Бронь 10к
        </button>
        <button type="button" className={cn(BTN, "border-success/50 bg-success/10 text-success")} onClick={() => onAction("paid")}>
          Полная оплата
        </button>
        <button type="button" className={cn(BTN, "border-primary/40 text-primary")} onClick={() => onAction("student")}>
          <GraduationCap className="h-3.5 w-3.5" /> Студент
        </button>
      </div>
      {(lead.webinarStatus || lead.depositAmount || lead.temperature) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {lead.webinarStatus && <span className="rounded bg-secondary/60 px-1.5 py-0.5">Вебинар: {lead.webinarStatus}</span>}
          {lead.depositAmount != null && lead.depositAmount > 0 && (
            <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">Бронь: {lead.depositAmount.toLocaleString("ru-RU")} ₸</span>
          )}
          {lead.temperature && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">{lead.temperature}</span>}
        </div>
      )}
    </div>
  );
}
