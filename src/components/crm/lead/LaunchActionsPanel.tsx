import { CalendarCheck, GraduationCap, HandCoins, MessageCircle, Phone, Send, UserCheck, Users, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";

export type LaunchAction =
  | "bot_activated"
  | "whatsapp" // alias
  | "joined_group"
  | "warming" // alias
  | "confirmed"
  | "webinar_attended"
  | "webinar_late"
  | "webinar_no_show"
  | "call_scheduled"
  | "call_done"
  | "offer"
  | "deposit"
  | "paid"
  | "student"
  | "graduate";

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
        <button type="button" className={BTN} onClick={() => onAction("bot_activated")}>
          <MessageCircle className="h-3.5 w-3.5" /> Бот ✓
        </button>
        <button type="button" className={BTN} onClick={() => onAction("joined_group")}>
          <Users className="h-3.5 w-3.5" /> В группе
        </button>
        <button type="button" className={BTN} onClick={() => onAction("confirmed")}>
          <UserCheck className="h-3.5 w-3.5" /> Подтвердил
        </button>
        <button type="button" className={cn(BTN, "border-success/40 text-success")} onClick={() => onAction("webinar_attended")}>
          <Video className="h-3.5 w-3.5" /> На вебинаре
        </button>
        <button type="button" className={BTN} onClick={() => onAction("webinar_late")}>
          Опоздал
        </button>
        <button type="button" className={cn(BTN, "border-destructive/40 text-destructive")} onClick={() => onAction("webinar_no_show")}>
          Не пришёл
        </button>
        <button type="button" className={cn(BTN, "border-success/40 text-success")} onClick={() => onAction("deposit", { amount: 10000 })}>
          <HandCoins className="h-3.5 w-3.5" /> Бронь 10к
        </button>
        <button type="button" className={BTN} onClick={() => onAction("call_scheduled")}>
          <CalendarCheck className="h-3.5 w-3.5" /> Созвон
        </button>
        <button type="button" className={BTN} onClick={() => onAction("call_done")}>
          <Phone className="h-3.5 w-3.5" /> Созвон ✓
        </button>
        <button type="button" className={BTN} onClick={() => onAction("offer")}>
          <Send className="h-3.5 w-3.5" /> Счёт / договор
        </button>
        <button type="button" className={cn(BTN, "border-success/50 bg-success/10 text-success")} onClick={() => onAction("paid")}>
          Полная оплата
        </button>
        <button type="button" className={cn(BTN, "border-primary/40 text-primary")} onClick={() => onAction("student")}>
          <GraduationCap className="h-3.5 w-3.5" /> Студент
        </button>
        <button type="button" className={cn(BTN, "border-primary/40 text-primary")} onClick={() => onAction("graduate")}>
          Выпускник
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
