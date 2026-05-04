import {
  CheckCircle2, FileText, MessageSquare, Phone, PhoneCall, Plus, ShoppingCart, Wallet, XCircle, Calendar, ArrowRight, Bell, RotateCcw, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { REJECT_REASONS, type Lead, type LeadEvent, type LeadEventType, type LeadStage, type RejectReason } from "@/types/crm";

interface Props {
  lead: Lead;
  stages: LeadStage[];
}

const META: Record<LeadEventType, { icon: typeof Phone; label: string; tone: string }> = {
  created: { icon: Plus, label: "Лид создан", tone: "text-primary" },
  stage_changed: { icon: ArrowRight, label: "Этап", tone: "text-primary" },
  message_sent: { icon: MessageSquare, label: "Сообщение", tone: "text-success" },
  call_made: { icon: Phone, label: "Звонок", tone: "text-primary" },
  task_created: { icon: FileText, label: "Задача", tone: "text-warning" },
  task_done: { icon: CheckCircle2, label: "Задача выполнена", tone: "text-success" },
  amount_changed: { icon: ShoppingCart, label: "Сумма", tone: "text-primary" },
  visit_scheduled: { icon: Calendar, label: "Запись на визит", tone: "text-warning" },
  paid: { icon: Wallet, label: "Оплачено", tone: "text-success" },
  rejected: { icon: XCircle, label: "Отказ", tone: "text-destructive" },
  automation_followup_2h: { icon: Bell, label: "Авто: дожим 2ч", tone: "text-warning" },
  automation_24h_sent: { icon: Zap, label: "Авто-сообщение 24ч", tone: "text-primary" },
  automation_revival_7d: { icon: RotateCcw, label: "Авто-возврат 7 дней", tone: "text-success" },
  call_attempt: { icon: PhoneCall, label: "Попытка вызова", tone: "text-muted-foreground" },
};

export function LeadLogTab({ lead, stages }: Props) {
  const events: LeadEvent[] = lead.events ?? [];
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at));
  const stageTitle = (id?: string) => stages.find((s) => s.id === id)?.title ?? id ?? "—";

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 px-3 py-8 text-center text-sm text-muted-foreground">
        Событий пока нет. Здесь появится хронология действий по лиду.
      </div>
    );
  }

  return (
    <ol className="relative space-y-2 border-l border-border/60 pl-4">
      {sorted.map((ev) => {
        const m = META[ev.type];
        const Icon = m.icon;
        let detail: React.ReactNode = null;
        if (ev.type === "stage_changed" && ev.payload) {
          detail = (
            <span className="text-xs text-muted-foreground">
              {stageTitle(String(ev.payload.from))} → <span className="font-semibold text-foreground">{stageTitle(String(ev.payload.to))}</span>
            </span>
          );
        } else if (ev.type === "amount_changed" && ev.payload) {
          detail = (
            <span className="text-xs text-muted-foreground tabular-nums">
              {Number(ev.payload.from).toLocaleString("ru-RU")} → <span className="font-semibold text-foreground">{Number(ev.payload.to).toLocaleString("ru-RU")} $</span>
            </span>
          );
        } else if (ev.type === "message_sent" && ev.payload?.text) {
          detail = <span className="text-xs text-muted-foreground truncate">«{ev.payload.text}»</span>;
        } else if (ev.type === "task_created" && ev.payload?.title) {
          detail = <span className="text-xs text-muted-foreground">{ev.payload.title}</span>;
        } else if (ev.type === "paid" && ev.payload) {
          detail = (
            <span className="text-xs text-muted-foreground tabular-nums">
              {Number(ev.payload.amount).toLocaleString("ru-RU")} $ · {String(ev.payload.method)}
            </span>
          );
        } else if (ev.type === "visit_scheduled" && ev.payload?.at) {
          detail = <span className="text-xs text-muted-foreground">{new Date(String(ev.payload.at)).toLocaleString("ru-RU")}</span>;
        } else if (ev.type === "rejected" && ev.payload) {
          const r = REJECT_REASONS.find((x) => x.id === (ev.payload?.reason as RejectReason));
          const noteText = ev.payload?.note ? String(ev.payload.note) : "";
          detail = (
            <span className="text-xs text-muted-foreground">
              {r ? <><span className="mr-1">{r.emoji}</span><span className="font-semibold text-foreground">{r.label}</span></> : "Причина не указана"}
              {noteText && <span className="text-muted-foreground"> — «{noteText}»</span>}
            </span>
          );
        } else if ((ev.type === "automation_24h_sent" || ev.type === "automation_revival_7d") && ev.payload?.preview) {
          detail = <span className="text-xs text-muted-foreground truncate">«{String(ev.payload.preview)}»</span>;
        } else if (ev.type === "call_attempt" && ev.payload) {
          const ok = ev.payload.ok === true || ev.payload.ok === "true";
          const provider = String(ev.payload.provider ?? "—");
          const reason = ev.payload.error ?? ev.payload.warning;
          detail = (
            <span className="text-xs">
              <span className={cn(
                "mr-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                ok ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
              )}>
                {ok ? "успех" : "ошибка"}
              </span>
              <span className="text-muted-foreground">{provider}</span>
              {reason && <span className="ml-1 text-muted-foreground">— {String(reason)}</span>}
            </span>
          );
        }

        return (
          <li key={ev.id} className="relative">
            <span className={cn(
              "absolute -left-[22px] top-1 grid h-4 w-4 place-items-center rounded-full bg-background ring-1 ring-border",
              m.tone,
            )}>
              <Icon className="h-2.5 w-2.5" />
            </span>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <div className={cn("text-sm font-semibold", m.tone)}>{m.label}</div>
                {detail && <div className="mt-0.5 truncate">{detail}</div>}
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground">
                {new Date(ev.at).toLocaleString("ru-RU")}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}