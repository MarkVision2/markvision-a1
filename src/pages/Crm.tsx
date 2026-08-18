import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Columns3,
  MessageCircle,
  Database,
  Sparkles,
  Users,
  BarChart3,
  Zap,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCrmStore } from "@/hooks/useCrmStore";
import { useCapiStageMap } from "@/hooks/useCapiStageMap";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { Lead } from "@/types/crm";
import { requiresDiagnosticDialog, requiresPaymentDialog, requiresRejectDialog, stageRoleOf } from "@/lib/stageRoles";
import { useTeamStore } from "@/hooks/useTeamStore";
import { useCrmAnalytics } from "@/hooks/useCrmAnalytics";
import { StageColumn } from "@/components/crm/StageColumn";
const ChatsView = lazy(() => import("@/components/crm/ChatsView").then((m) => ({ default: m.ChatsView })));
const ClientsView = lazy(() => import("@/components/crm/ClientsView").then((m) => ({ default: m.ClientsView })));
import { NewLeadDialog } from "@/components/crm/NewLeadDialog";
import { LeadDetailSheet } from "@/components/crm/LeadDetailSheet";
import { CrmFilters, type CrmFilterState } from "@/components/crm/CrmFilters";
import { CrmTodayView } from "@/components/crm/CrmTodayView";
import { RejectReasonDialog } from "@/components/crm/RejectReasonDialog";
import { PaymentAmountDialog } from "@/components/crm/PaymentAmountDialog";
import { DiagnosticAmountDialog } from "@/components/crm/DiagnosticAmountDialog";
const ManagersView = lazy(() => import("@/components/crm/ManagersView").then((m) => ({ default: m.ManagersView })));
const AnalyticsView = lazy(() => import("@/components/crm/AnalyticsView").then((m) => ({ default: m.AnalyticsView })));
const AutomationsSettings = lazy(() =>
  import("@/components/crm/AutomationsSettings").then((m) => ({ default: m.AutomationsSettings })),
);
const CapiSettings = lazy(() =>
  import("@/components/crm/CapiSettings").then((m) => ({ default: m.CapiSettings })),
);
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  findStageAutomationRule,
  loadStageAutomationRules,
  markStageAutomationSent,
  renderStageAutomationTemplate,
  wasStageAutomationSent,
} from "@/lib/stageAutomations";

type Tab = "today" | "funnel" | "chats" | "clients" | "managers" | "analytics" | "automations" | "capi";

const Crm = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    stages,
    leads,
    chats,
    whatsapp,
    addStage,
    renameStage,
    removeStage,
    moveStage,
    addLead,
    updateLead,
    removeLead,
    removeLeads,
    markPersonal,
    moveLead,
    sendMessage,
    sendVoice,
    togglePin,
    assignLead,
    setRejectReason,
    markCall,
    logCallAttempt,
    markPaid,
    setVisit,
    applyLaunchAction,
    pipelineTemplateKey,
    addTask,
    toggleTask,
    removeTask,
  } = useCrmStore();
  const { members } = useTeamStore();
  const { activeId: projectId } = useProjectsStore();
  const capiStageMap = useCapiStageMap(projectId);

  const TABS: { id: Tab; label: string; icon: typeof Columns3 }[] = useMemo(
    () => [
      { id: "today", label: "Сегодня", icon: Sparkles },
      { id: "funnel", label: "Воронка", icon: Columns3 },
      { id: "chats", label: "Чаты", icon: MessageCircle },
      { id: "clients", label: "База", icon: Database },
      { id: "managers", label: "Менеджеры", icon: Users },
      { id: "analytics", label: "Аналитика", icon: BarChart3 },
      { id: "automations", label: "Автоматизация", icon: Zap },
      ...(isAdmin ? [{ id: "capi" as Tab, label: "Meta CAPI", icon: Radio }] : []),
    ],
    [isAdmin],
  );

  const [tab, setTab] = useState<Tab>("today");
  const [newOpen, setNewOpen] = useState(false);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [newStageDraft, setNewStageDraft] = useState("");
  const [addingStage, setAddingStage] = useState(false);
  const [filters, setFilters] = useState<CrmFilterState>({ search: "", source: null, assigneeId: null });
  const [rejectFor, setRejectFor] = useState<{ leadId: string; prevStageId?: string; viaDrag: boolean } | null>(null);
  const [payFor, setPayFor] = useState<{ leadId: string; prevStageId?: string } | null>(null);
  const [diagFor, setDiagFor] = useState<{ leadId: string; stageId: string } | null>(null);
  const leadsRef = useRef(leads);

  useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);

  useEffect(() => {
    const id = searchParams.get("lead");
    if (id && id !== activeLeadId) setActiveLeadId(id);
  }, [searchParams, activeLeadId]);

  const activeLead = useMemo(
    () => leads.find((l) => l.id === activeLeadId) ?? null,
    [leads, activeLeadId],
  );

  const busySlots = useMemo(
    () =>
      leads
        .filter((l) => l.nextVisitAt && l.id !== activeLeadId)
        .map((l) => ({ iso: l.nextVisitAt as string, leadName: l.name })),
    [leads, activeLeadId],
  );

  const sources = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => l.source && set.add(l.source));
    return Array.from(set).sort();
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return leads.filter((l) => {
      if (filters.source && l.source !== filters.source) return false;
      if (filters.assigneeId && l.assigneeId !== filters.assigneeId) return false;
      if (q && !l.name.toLowerCase().includes(q) && !l.phone.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [leads, filters]);

  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const l of filteredLeads) {
      const arr = map.get(l.stageId);
      if (arr) arr.push(l);
      else map.set(l.stageId, [l]);
    }
    return map;
  }, [filteredLeads]);
  const EMPTY_LEADS: Lead[] = useMemo(() => [], []);

  const analytics = useCrmAnalytics(leads, stages, members);

  const handleAddStage = () => {
    const name = newStageDraft.trim();
    if (!name) {
      setAddingStage(false);
      return;
    }
    addStage(name);
    setNewStageDraft("");
    setAddingStage(false);
    toast.success("Этап добавлен");
  };

  const runStageAutomation = useCallback(async (
    leadId: string,
    stageId: string,
    opts?: { leadOverride?: Lead; visitAt?: string | null },
  ) => {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const rules = loadStageAutomationRules(projectId, stages);
    const rule = findStageAutomationRule(rules, stageId);
    if (!rule || wasStageAutomationSent(projectId, leadId, rule.id, stageId)) return;

    const lead = opts?.leadOverride ?? leadsRef.current.find((item) => item.id === leadId);
    if (!lead?.phone) return;
    const managerName = members.find((member) => member.id === lead.assigneeId)?.name ?? null;
    const text = renderStageAutomationTemplate(rule.template, {
      lead,
      stage,
      managerName,
      visitAt: opts?.visitAt,
    }).trim();
    if (!text) return;

    try {
      const sent = await sendMessage(leadId, text, { templateKey: `stage_auto:${rule.id}`, channel: "whatsapp" });
      if (sent === false) {
        toast.error("Автосообщение не отправлено: проверьте WhatsApp");
        return;
      }
      markStageAutomationSent(projectId, leadId, rule.id, stageId);
      toast.success("Автосообщение отправлено");
    } catch (error) {
      console.error("[Crm.runStageAutomation] failed", error);
      toast.error("Не удалось отправить автосообщение");
    }
  }, [members, projectId, sendMessage, stages]);

  const handleDropLead = useCallback((leadId: string, stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);
    const role = stageRoleOf(stage);
    if (requiresRejectDialog(role) || stageId === "rejected") {
      const current = leads.find((l) => l.id === leadId);
      // Не двигаем этап до выбора причины (DB trigger enforce_reject_reason).
      setRejectFor({ leadId, prevStageId: current?.stageId, viaDrag: true });
      return;
    }
    if (requiresPaymentDialog(role) || stageId === "paid") {
      const current = leads.find((l) => l.id === leadId);
      setPayFor({ leadId, prevStageId: current?.stageId });
      return;
    }
    if (requiresDiagnosticDialog(role, {
      isDiagnostic: stage?.isDiagnostic,
      templateKey: pipelineTemplateKey,
    })) {
      setDiagFor({ leadId, stageId });
      return;
    }
    void (async () => {
      await moveLead(leadId, stageId);
      await runStageAutomation(leadId, stageId);
    })();
  }, [leads, moveLead, runStageAutomation, stages, pipelineTemplateKey]);

  const handleOpenLead = useCallback((l: Lead) => setActiveLeadId(l.id), []);
  const handleDeleteStage = useCallback((id: string) => {
    if (confirm("Удалить этап? Лиды перейдут в первый этап.")) {
      removeStage(id, stages[0]?.id);
      toast.success("Этап удалён");
    }
  }, [removeStage, stages]);

  return (
    <main className="flex min-h-0 flex-1 flex-col animate-fade-in-up">
      {/* Compact header */}
      <header className="border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/30">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <div className="text-base font-bold sm:text-lg">CRM</div>
              <div className="text-[10px] text-muted-foreground sm:text-xs">
                Лиды · Воронка · AI-скоринг
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!whatsapp.connected && (
              <Button
                onClick={() => navigate("/settings/connection")}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">WhatsApp</span>
              </Button>
            )}
            <Button
              onClick={() => setNewOpen(true)}
              size="sm"
              className="bg-gradient-primary text-primary-foreground shadow-glow"
            >
              <Plus className="h-3.5 w-3.5" />
              Новый лид
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto mt-3 flex max-w-[1600px] gap-1 overflow-x-auto scrollbar-none touch-pan-x pb-0.5">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5",
                  active
                    ? "bg-success/15 text-success"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Tab content — fills remaining viewport */}
      <section className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6">
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col">
          {tab === "today" && (
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              <CrmTodayView
                leads={leads}
                onOpenFunnel={() => setTab("funnel")}
              />
            </div>
          )}

          {tab === "funnel" && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <CrmFilters
                state={filters}
                onChange={setFilters}
                sources={sources}
                members={members}
              />

              <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
                {stages.map((stage, idx) => (
                  <div
                    key={stage.id}
                    className="flex h-full shrink-0"
                  >
                    <StageColumn
                      stage={stage}
                      stages={stages}
                      leads={leadsByStage.get(stage.id) ?? EMPTY_LEADS}
                      metrics={analytics.stageMetrics[idx]}
                      members={members}
                      isFirst={idx === 0}
                      isLast={idx === stages.length - 1}
                      canDelete={stages.length > 2}
                      onRename={renameStage}
                      onMove={moveStage}
                      onDelete={handleDeleteStage}
                      onDeleteLeads={async (ids) => {
                        const { deleted } = await removeLeads(ids);
                        if (deleted > 0) {
                          toast.success(deleted === 1 ? "Сделка удалена" : `Удалено сделок: ${deleted}`);
                        }
                      }}
                      onDropLead={handleDropLead}
                      onOpenLead={handleOpenLead}
                      onTogglePin={togglePin}
                      capiEvent={capiStageMap.get(String(stage.stageRole ?? stage.id).toLowerCase()) ?? null}
                    />
                  </div>
                ))}

                {/* Ghost "add stage" column */}
                <div className="flex h-full w-[260px] shrink-0 flex-col">
                  {addingStage ? (
                    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-3">
                      <Input
                        autoFocus
                        value={newStageDraft}
                        onChange={(e) => setNewStageDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddStage();
                          if (e.key === "Escape") { setNewStageDraft(""); setAddingStage(false); }
                        }}
                        onBlur={handleAddStage}
                        placeholder="Название этапа..."
                        maxLength={40}
                        className="h-9"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        Enter — сохранить · Esc — отмена
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingStage(true)}
                      className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/30 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                      title="Добавить новый этап"
                    >
                      <Plus className="h-4 w-4" />
                      Этап
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Загрузка…</div>}>
            {tab === "chats" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <ChatsView
                  leads={leads}
                  stages={stages}
                  chats={chats}
                  whatsapp={whatsapp}
                  onSend={sendMessage}
                  onSendVoice={(id, payload) => sendVoice(id, payload)}
                  onConnectWhatsApp={() => navigate("/settings/connection")}
                />
              </div>
            )}

            {tab === "clients" && (
              <ClientsView
                leads={leads}
                stages={stages}
                onOpenLead={(l) => setActiveLeadId(l.id)}
              />
            )}

            {tab === "managers" && <ManagersView stats={analytics.managerStats} />}

            {tab === "analytics" && (
              <AnalyticsView
                stageMetrics={analytics.stageMetrics}
                rejectStats={analytics.rejectStats}
                forecast={analytics.forecast}
                actual={analytics.actual}
                leads={leads}
                pipelineTemplateKey={pipelineTemplateKey}
              />
            )}

            {tab === "automations" && (
              <AutomationsSettings
                stages={stages}
                projectId={projectId}
                whatsappConnected={whatsapp.connected}
              />
            )}

            {tab === "capi" && <CapiSettings />}
          </Suspense>
        </div>
      </section>

      {/* Dialogs */}
      <NewLeadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        stages={stages}
        onCreate={(input) => {
          void (async () => {
            const lead = await addLead(input);
            if (lead) await runStageAutomation(lead.id, lead.stageId, { leadOverride: lead });
          })();
          toast.success("Лид добавлен в воронку");
        }}
      />

      <LeadDetailSheet
        lead={activeLead}
        stages={stages}
        members={members}
        chats={chats}
        whatsapp={whatsapp}
        open={!!activeLead}
        onOpenChange={(v) => {
          if (!v) {
            setActiveLeadId(null);
            if (searchParams.get("lead")) {
              const next = new URLSearchParams(searchParams);
              next.delete("lead");
              setSearchParams(next, { replace: true });
            }
          }
        }}
        onUpdate={(id, patch) => {
          void (async () => {
            await updateLead(id, patch);
            if (patch.stageId) await runStageAutomation(id, patch.stageId);
          })();
        }}
        onDelete={async (id) => {
          const ok = await removeLead(id);
          if (ok) toast.success("Лид удалён");
        }}
        onMarkPersonal={(id) => {
          markPersonal(id);
          toast.success("Заявка убрана в личные — её больше нет в CRM");
        }}
        onTogglePin={togglePin}
        onAssign={assignLead}
        onSendMessage={(id, text) => sendMessage(id, text)}
        onSendVoice={(id, payload) => sendVoice(id, payload)}
        onMarkCall={(id, opts) => {
          markCall(id, opts);
          toast.success(
            opts?.status === "missed"
              ? "Звонок без ответа сохранён"
              : opts?.direction === "incoming"
              ? "Входящий звонок сохранён"
              : "Звонок зафиксирован",
          );
        }}
        onLogCallAttempt={(id, info) => logCallAttempt(id, info)}
        onMarkPaid={(id, method, amount, opts) => {
          markPaid(id, method, amount, opts);
          toast.success("Оплата зафиксирована");
        }}
        onSetVisit={(id, iso) => {
          void (async () => {
            await setVisit(id, iso);
            const scheduled = stages.find((s) => s.stageRole === "call_scheduled")?.id ?? "scheduled";
            await runStageAutomation(id, scheduled, { visitAt: iso });
          })();
          toast.success("Визит назначен");
        }}
        onAddTask={addTask}
        onToggleTask={toggleTask}
        onRemoveTask={removeTask}
        onRequestReject={(id) => {
          const current = leads.find((l) => l.id === id);
          setRejectFor({ leadId: id, prevStageId: current?.stageId, viaDrag: false });
        }}
        onRequestPay={(id) => {
          const current = leads.find((l) => l.id === id);
          setPayFor({ leadId: id, prevStageId: current?.stageId });
        }}
        onRequestDiagnostic={(id) => {
          const scheduled = stages.find((s) => s.stageRole === "call_scheduled")?.id ?? "scheduled";
          setDiagFor({ leadId: id, stageId: scheduled });
        }}
        onLaunchAction={(id, action, opts) => {
          void applyLaunchAction(id, action, opts);
          toast.success("Статус обновлён");
        }}
        pipelineTemplateKey={pipelineTemplateKey}
        busySlots={busySlots}
      />

      <RejectReasonDialog
        open={!!rejectFor}
        required
        allowCancel={!!rejectFor && !rejectFor.viaDrag}
        onCancel={() => setRejectFor(null)}
        onOpenChange={(v) => { if (!v) setRejectFor(null); }}
        onPick={(reason, note) => {
          if (rejectFor) {
            void setRejectReason(rejectFor.leadId, reason, note);
            toast.success("Лид закрыт. Причина сохранена в истории.");
          }
          setRejectFor(null);
        }}
      />

      <PaymentAmountDialog
        open={!!payFor}
        defaultAmount={payFor ? leads.find((l) => l.id === payFor.leadId)?.amount : undefined}
        onOpenChange={(v) => { if (!v) setPayFor(null); }}
        onCancel={() => setPayFor(null)}
        onConfirm={(method, amount, opts) => {
          if (!payFor) return;
          markPaid(payFor.leadId, method, amount, opts);
          toast.success("Оплата зафиксирована, сделка в «Оплачен»");
          setPayFor(null);
        }}
      />

      <DiagnosticAmountDialog
        open={!!diagFor}
        defaultAmount={diagFor ? leads.find((l) => l.id === diagFor.leadId)?.diagnosticAmount : undefined}
        onOpenChange={(v) => { if (!v) setDiagFor(null); }}
        onCancel={() => setDiagFor(null)}
        onConfirm={async (amount) => {
          if (!diagFor) return;
          // Атомарно: сумма + переход в этап одним апдейтом. Триггер
          // on_lead_stage_change_attribution прочитает diagnostic_amount уже из
          // обновлённой строки — без гонки между двумя апдейтами.
          await updateLead(diagFor.leadId, { diagnosticAmount: amount, stageId: diagFor.stageId });
          await runStageAutomation(diagFor.leadId, diagFor.stageId);
          toast.success(
            amount > 0
              ? `Диагностика на ${Math.round(amount).toLocaleString("ru-RU")} ₸ зафиксирована`
              : "Бесплатная диагностика зафиксирована",
          );
          setDiagFor(null);
        }}
      />


    </main>
  );
};

export default Crm;
