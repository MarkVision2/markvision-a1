import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
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
import { LaunchActionsPanel, type LaunchAction } from "./lead/LaunchActionsPanel";
import {
  requiresDiagnosticDialog,
  requiresPaymentDialog,
  requiresRejectDialog,
  stageRoleOf,
} from "@/lib/stageRoles";

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
  onSendVoice?: (id: string, payload: { base64: string; mime: string; durationSec?: number }) => void | Promise<void>;
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
  onLaunchAction?: (
    id: string,
    action: LaunchAction,
    opts?: { amount?: number },
  ) => void;
  pipelineTemplateKey?: string | null;
  /** Other leads' booked visits (ISO timestamps) — used by visit popover. */
  busySlots?: { iso: string; leadName?: string }[];
}

export function LeadDetailSheet({
  lead, stages, members, chats, whatsapp, open, onOpenChange,
  onUpdate, onDelete, onMarkPersonal, onTogglePin, onAssign, onSendMessage, onSendVoice,
  onMarkCall, onLogCallAttempt, onMarkPaid, onSetVisit, onAddTask, onToggleTask, onRemoveTask, onRequestReject, onRequestPay, onRequestDiagnostic,
  onLaunchAction, pipelineTemplateKey,
  busySlots,
}: Props) {
  const [tab, setTab] = useState("deal");

  // Desktop has a side chat — don't leave the mobile-only "chat" tab active after resize.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      if (mq.matches) setTab((t) => (t === "chat" ? "deal" : t));
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [open]);

  if (!lead) return null;

  const stageTitle = stages.find((s) => s.id === lead.stageId)?.title;
  const leadChats = chats.filter((c) => c.leadId === lead.id);
  const isLaunch = pipelineTemplateKey === "launch";
  const chatTabActive = tab === "chat";

  const handleChangeStage = (sid: string) => {
    if (sid === lead.stageId) return;
    const stage = stages.find((s) => s.id === sid);
    const role = stageRoleOf(stage);
    if (requiresRejectDialog(role) || sid === "rejected") {
      onRequestReject(lead.id);
      return;
    }
    if (requiresPaymentDialog(role) || sid === "paid") {
      onRequestPay(lead.id);
      return;
    }
    if (
      onRequestDiagnostic
      && requiresDiagnosticDialog(role, {
        isDiagnostic: stage?.isDiagnostic,
        templateKey: pipelineTemplateKey,
      })
    ) {
      onRequestDiagnostic(lead.id);
      return;
    }
    onUpdate(lead.id, { stageId: sid });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none"
        onPointerDownOutside={(e) => {
          if (document.querySelector("[data-crm-image-lightbox]")) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (document.querySelector("[data-crm-image-lightbox]")) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (document.querySelector("[data-crm-image-lightbox]")) e.preventDefault();
        }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{lead.name}</SheetTitle>
        </SheetHeader>

        {/* md+: side chat from 768 — closes the 768–1023 gap where chat was missing */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(360px,440px)_1fr] lg:grid-cols-[minmax(400px,480px)_1fr]">
          {/* LEFT: lead fields */}
          <div className="flex min-h-0 flex-col border-r border-border/50 bg-background">
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                chatTabActive ? "md:overflow-y-auto" : "overflow-y-auto",
              )}
            >
              <div
                className={cn(
                  "space-y-4 px-4 pt-5 sm:px-5",
                  chatTabActive && "max-md:hidden",
                )}
              >
                <LeadHeader
                  lead={lead}
                  stages={stages}
                  members={members}
                  onUpdate={(patch) => onUpdate(lead.id, patch)}
                  onTogglePin={() => onTogglePin(lead.id)}
                  onAssign={(aid) => onAssign(lead.id, aid)}
                  onChangeStage={handleChangeStage}
                />

                <LeadActionPanel
                  lead={lead}
                  onCall={(opts) => onMarkCall(lead.id, opts)}
                  onCallAttempt={onLogCallAttempt ? (info) => onLogCallAttempt(lead.id, info) : undefined}
                  onScheduleVisit={(iso) => onSetVisit(lead.id, iso)}
                  onMarkPaid={(method, amount, opts) => onMarkPaid(lead.id, method, amount, opts)}
                  onClose={() => onRequestReject(lead.id)}
                  onWrite={(text) => { if (text.trim()) onSendMessage(lead.id, text); }}
                  busySlots={busySlots}
                />

                {isLaunch && onLaunchAction && (
                  <LaunchActionsPanel
                    lead={lead}
                    onAction={(action, opts) => {
                      if (action === "paid") {
                        onRequestPay(lead.id);
                        return;
                      }
                      onLaunchAction(lead.id, action, opts);
                    }}
                  />
                )}
              </div>

              {/* Compact header when mobile chat tab is open */}
              {chatTabActive && (
                <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3 md:hidden">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-sm font-semibold text-primary">
                    {lead.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 pr-10">
                    <div className="truncate text-sm font-semibold">{lead.name}</div>
                    {stageTitle && (
                      <div className="truncate text-[11px] text-muted-foreground">{stageTitle}</div>
                    )}
                  </div>
                </div>
              )}

              <Tabs
                value={tab}
                onValueChange={setTab}
                className={cn(
                  "flex min-h-0 flex-col px-4 pb-5 pt-4 sm:px-5",
                  chatTabActive && "max-md:min-h-0 max-md:flex-1 max-md:pb-2",
                )}
              >
                <TabsList className="grid h-auto w-full grid-cols-5 gap-1 rounded-2xl bg-secondary/40 p-1 md:grid-cols-4">
                  <TabsTrigger value="deal" className="min-h-10 gap-1 rounded-xl px-1 py-2 text-[10px] data-[state=active]:shadow-sm sm:text-xs">
                    <ShoppingCart className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Сделка</span>
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="min-h-10 gap-1 rounded-xl px-1 py-2 text-[10px] data-[state=active]:shadow-sm sm:text-xs">
                    <ListChecks className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Задачи</span>
                  </TabsTrigger>
                  <TabsTrigger value="profile" className="min-h-10 gap-1 rounded-xl px-1 py-2 text-[10px] data-[state=active]:shadow-sm sm:text-xs">
                    <User className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Профиль</span>
                  </TabsTrigger>
                  <TabsTrigger value="log" className="min-h-10 gap-1 rounded-xl px-1 py-2 text-[10px] data-[state=active]:shadow-sm sm:text-xs">
                    <History className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Лог</span>
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="min-h-10 gap-1 rounded-xl px-1 py-2 text-[10px] data-[state=active]:shadow-sm sm:text-xs md:hidden">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Чат</span>
                  </TabsTrigger>
                </TabsList>

                <div
                  className={cn(
                    "mt-3.5",
                    chatTabActive && "max-md:mt-2 max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col",
                  )}
                >
                  <TabsContent value="deal" className="m-0 data-[state=inactive]:hidden">
                    <LeadDealTab
                      lead={lead}
                      stages={stages}
                      onUpdate={(p) => onUpdate(lead.id, p)}
                      onChangeStage={handleChangeStage}
                      onScheduleVisit={(iso) => onSetVisit(lead.id, iso)}
                      busySlots={busySlots}
                    />
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
                  <TabsContent
                    value="chat"
                    className="m-0 min-h-0 data-[state=inactive]:hidden max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col md:hidden"
                  >
                    <LeadChatPanel
                      lead={lead}
                      chats={leadChats}
                      whatsappConnected={whatsapp.connected}
                      stageTitle={stageTitle}
                      onSend={(txt) => onSendMessage(lead.id, txt)}
                      onSendVoice={onSendVoice ? (p) => onSendVoice(lead.id, p) : undefined}
                      className="min-h-0 flex-1"
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </div>

            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-background/80 px-4 py-3 backdrop-blur-sm sm:px-5",
                chatTabActive && "max-md:hidden",
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm("Удалить лида?")) {
                      onDelete(lead.id);
                      onOpenChange(false);
                    }
                  }}
                  className="h-10 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />Удалить
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
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
                  className="h-10 rounded-xl text-muted-foreground"
                  title="Скрыть лид как личную переписку — он не будет учитываться нигде в CRM и аналитике"
                >
                  <EyeOff className="h-4 w-4" />Убрать в личные
                </Button>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-xl px-4"
              >
                Закрыть
              </Button>
            </div>
          </div>

          <div className="hidden min-h-0 flex-col bg-muted/15 md:flex">
            <div className="flex items-center gap-2 border-b border-border/50 px-5 py-3.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-secondary/60">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">Чат с клиентом</div>
                {stageTitle && (
                  <div className="truncate text-[11px] text-muted-foreground">{stageTitle}</div>
                )}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <LeadChatPanel
                lead={lead}
                chats={leadChats}
                whatsappConnected={whatsapp.connected}
                stageTitle={stageTitle}
                onSend={(t) => onSendMessage(lead.id, t)}
                onSendVoice={onSendVoice ? (p) => onSendVoice(lead.id, p) : undefined}
              />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
