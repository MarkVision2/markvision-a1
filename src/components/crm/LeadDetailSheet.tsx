import { useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Trash2, MessageSquare, ShoppingCart, ListChecks, User, History, EyeOff } from "lucide-react";
import type { ChatMessage, Lead, LeadStage, PaymentMethod, WhatsAppConfig } from "@/types/crm";
import type { TeamMember } from "@/hooks/useTeamStore";
import { LeadHeader } from "./lead/LeadHeader";
import { LeadActionPanel } from "./lead/LeadActionPanel";
import { LeadChatPanel } from "./lead/LeadChatPanel";
import { LeadDealTab } from "./lead/LeadDealTab";
import { LeadTasksTab } from "./lead/LeadTasksTab";
import { LeadProfileTab } from "./lead/LeadProfileTab";
import { LeadLogTab } from "./lead/LeadLogTab";

interface Props {
  lead: Lead | null;
  stages: LeadStage[];
  members: TeamMember[];
  chats: ChatMessage[];
  whatsapp: WhatsAppConfig;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdate: (id: string, patch: Partial<Lead>) => void;
  onDelete: (id: string) => void;
  onMarkPersonal: (id: string) => void;
  onTogglePin: (id: string) => void;
  onAssign: (id: string, assigneeId?: string) => void;
  onSendMessage: (id: string, text: string) => void;
  onMarkCall: (id: string, opts?: { direction?: "outgoing" | "incoming"; status?: "answered" | "missed"; durationSec?: number; note?: string }) => void;
  onLogCallAttempt?: (id: string, info: { provider: string; ok: boolean; phone?: string; warning?: string; error?: string }) => void;
  onMarkPaid: (id: string, method: PaymentMethod, amount: number, opts?: { note?: string }) => void;
  onSetVisit: (id: string, iso: string) => void;
  onAddTask: (id: string, title: string, dueAt: string) => void;
  onToggleTask: (id: string, taskId: string) => void;
  onRemoveTask: (id: string, taskId: string) => void;
  onRequestReject: (id: string) => void;
  /** Перевод сделки в этап «Оплачен» — обязательно через диалог суммы. */
  onRequestPay: (id: string) => void;
  /** Перевод в «Запись на диагностику» — диалог стоимости диагностики (можно 0). */
  onRequestDiagnostic?: (id: string) => void;
  /** Other leads' booked visits (ISO timestamps) — used by visit popover. */
  busySlots?: { iso: string; leadName?: string }[];
}

export function LeadDetailSheet({
  lead, stages, members, chats, whatsapp, open, onOpenChange,
  onUpdate, onDelete, onMarkPersonal, onTogglePin, onAssign, onSendMessage,
  onMarkCall, onLogCallAttempt, onMarkPaid, onSetVisit, onAddTask, onToggleTask, onRemoveTask, onRequestReject, onRequestPay, onRequestDiagnostic,
  busySlots,
}: Props) {
  const [tab, setTab] = useState("deal");

  if (!lead) return null;

  const stageTitle = stages.find((s) => s.id === lead.stageId)?.title;
  const leadChats = chats.filter((c) => c.leadId === lead.id);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{lead.name}</SheetTitle>
        </SheetHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(420px,520px)_1fr]">
          {/* LEFT: lead fields */}
          <div className="flex min-h-0 flex-col border-r border-border/60">
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 pt-5">
                <LeadHeader
                  lead={lead}
                  stages={stages}
                  members={members}
                  onUpdate={(patch) => onUpdate(lead.id, patch)}
                  onTogglePin={() => onTogglePin(lead.id)}
                  onAssign={(aid) => onAssign(lead.id, aid)}
                  onChangeStage={(sid) => {
                    if (sid === "rejected") {
                      onRequestReject(lead.id);
                      onUpdate(lead.id, { stageId: sid });
                      return;
                    }
                    if (sid === "paid") {
                      // Этап «Оплачен» нельзя выставлять без суммы — ждём диалог.
                      // markPaid внутри обработчика подтверждения сам переведёт stage и создаст deal.
                      onRequestPay(lead.id);
                      return;
                    }
                    if (sid === "scheduled" && onRequestDiagnostic) {
                      onRequestDiagnostic(lead.id);
                      return;
                    }
                    onUpdate(lead.id, { stageId: sid });
                  }}
                />
              </div>

              <div className="px-5 pt-3">
                <LeadActionPanel
                  lead={lead}
                  onCall={(opts) => onMarkCall(lead.id, opts)}
                  onCallAttempt={onLogCallAttempt ? (info) => onLogCallAttempt(lead.id, info) : undefined}
                  onScheduleVisit={(iso) => onSetVisit(lead.id, iso)}
                  onMarkPaid={(method, amount, opts) => onMarkPaid(lead.id, method, amount, opts)}
                  onClose={() => onRequestReject(lead.id)}
                  busySlots={busySlots}
                />
              </div>

              <Tabs value={tab} onValueChange={setTab} className="flex flex-col px-5 pt-3 pb-4">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="deal" className="gap-1 text-xs"><ShoppingCart className="h-3.5 w-3.5" />Сделка</TabsTrigger>
                  <TabsTrigger value="tasks" className="gap-1 text-xs"><ListChecks className="h-3.5 w-3.5" />Задачи</TabsTrigger>
                  <TabsTrigger value="profile" className="gap-1 text-xs"><User className="h-3.5 w-3.5" />Профиль</TabsTrigger>
                  <TabsTrigger value="log" className="gap-1 text-xs"><History className="h-3.5 w-3.5" />Лог</TabsTrigger>
                </TabsList>

                <div className="mt-3">
                  <TabsContent value="deal" className="m-0 data-[state=inactive]:hidden">
                    <LeadDealTab lead={lead} onUpdate={(p) => onUpdate(lead.id, p)} />
                  </TabsContent>
                  <TabsContent value="tasks" className="m-0 data-[state=inactive]:hidden">
                    <LeadTasksTab
                      tasks={lead.tasks ?? []}
                      onAdd={(title, due) => onAddTask(lead.id, title, due)}
                      onToggle={(tid) => onToggleTask(lead.id, tid)}
                      onRemove={(tid) => onRemoveTask(lead.id, tid)}
                    />
                  </TabsContent>
                  <TabsContent value="profile" className="m-0 data-[state=inactive]:hidden">
                    <LeadProfileTab lead={lead} onUpdate={(p) => onUpdate(lead.id, p)} />
                  </TabsContent>
                  <TabsContent value="log" className="m-0 data-[state=inactive]:hidden">
                    <LeadLogTab lead={lead} stages={stages} />
                  </TabsContent>
                </div>
              </Tabs>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Удалить лида?")) {
                      onDelete(lead.id);
                      onOpenChange(false);
                    }
                  }}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />Удалить
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm(
                      "Убрать в личные?\n\nЭто не клиент — заявка пришла из вашей личной переписки. " +
                      "После подтверждения лид полностью исчезнет из CRM: воронки, чатов, базы и аналитики. " +
                      "Восстановить из интерфейса нельзя.",
                    )) {
                      onMarkPersonal(lead.id);
                      onOpenChange(false);
                    }
                  }}
                  title="Скрыть лид как личную переписку — он не будет учитываться нигде в CRM и аналитике"
                >
                  <EyeOff className="h-4 w-4" />Убрать в личные
                </Button>
              </div>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button>
            </div>
          </div>

          {/* RIGHT: persistent chat */}
          <div className="flex min-h-0 flex-col bg-muted/20">
            <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Чат с клиентом</span>
              {stageTitle && (
                <span className="ml-auto text-xs text-muted-foreground">{stageTitle}</span>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <LeadChatPanel
                lead={lead}
                chats={leadChats}
                whatsappConnected={whatsapp.connected}
                stageTitle={stageTitle}
                onSend={(t) => onSendMessage(lead.id, t)}
              />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
