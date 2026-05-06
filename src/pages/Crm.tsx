import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Columns3,
  MessageCircle,
  Database,
  Plus,
  Sparkles,
  Users,
  BarChart3,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCrmStore } from "@/hooks/useCrmStore";
import type { Lead } from "@/types/crm";
import { useTeamStore } from "@/hooks/useTeamStore";
import { useCrmAnalytics } from "@/hooks/useCrmAnalytics";
import { StageColumn } from "@/components/crm/StageColumn";
import { ChatsView } from "@/components/crm/ChatsView";
import { ClientsView } from "@/components/crm/ClientsView";
import { NewLeadDialog } from "@/components/crm/NewLeadDialog";
import { LeadDetailSheet } from "@/components/crm/LeadDetailSheet";
import { ConnectWhatsAppDialog } from "@/components/crm/ConnectWhatsAppDialog";
import { CrmKpiBar } from "@/components/crm/CrmKpiBar";
import { SlaAlerts } from "@/components/crm/SlaAlerts";
import { CrmFilters, type CrmFilterState } from "@/components/crm/CrmFilters";
import { RejectReasonDialog } from "@/components/crm/RejectReasonDialog";
import { ManagersView } from "@/components/crm/ManagersView";
import { AnalyticsView } from "@/components/crm/AnalyticsView";
import { AutomationsSettings } from "@/components/crm/AutomationsSettings";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type Tab = "funnel" | "chats" | "clients" | "managers" | "analytics" | "automations";

const BASE_TABS: { id: Tab; label: string; icon: typeof Columns3 }[] = [
  { id: "funnel", label: "Воронка", icon: Columns3 },
  { id: "chats", label: "Чаты", icon: MessageCircle },
  { id: "clients", label: "База клиентов", icon: Database },
  { id: "managers", label: "Менеджеры", icon: Users },
  { id: "analytics", label: "Аналитика", icon: BarChart3 },
];

const Crm = () => {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    stages,
    leads,
    chats,
    whatsapp,
    setWhatsapp,
    addLead,
    updateLead,
    removeLead,
    moveLead,
    sendMessage,
    togglePin,
    assignLead,
    setRejectReason,
    markCall,
    logCallAttempt,
    markPaid,
    setVisit,
    addTask,
    toggleTask,
    removeTask,
  } = useCrmStore();
  const { members } = useTeamStore();

  const [tab, setTab] = useState<Tab>("funnel");
  const [newOpen, setNewOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);

  // Open a lead via ?lead=<id> (e.g. from "История звонков").
  useEffect(() => {
    const id = searchParams.get("lead");
    if (id && id !== activeLeadId) setActiveLeadId(id);
  }, [searchParams, activeLeadId]);
  const [filters, setFilters] = useState<CrmFilterState>({ search: "", source: null, assigneeId: null });
  const [rejectFor, setRejectFor] = useState<{ leadId: string; prevStageId?: string; viaDrag: boolean } | null>(null);

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

  const noAnswerRef = useRef<HTMLDivElement | null>(null);

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

  // Index leads by stageId once — avoids O(N×M) refilter inside stages.map on every render.
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

  const handleDropLead = useCallback((leadId: string, stageId: string) => {
    if (stageId === "rejected") {
      const current = leads.find((l) => l.id === leadId);
      const prev = current?.stageId;
      moveLead(leadId, stageId);
      setRejectFor({ leadId, prevStageId: prev, viaDrag: true });
      return;
    }
    moveLead(leadId, stageId);
  }, [leads, moveLead]);

  const handleOpenLead = useCallback((l: Lead) => setActiveLeadId(l.id), []);

  const jumpToNoAnswer = () => {
    setTab("funnel");
    setTimeout(() => {
      noAnswerRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }, 50);
  };

  return (
    <main className="container max-w-[1400px] py-8 sm:py-10 animate-fade-in-up">
      {/* hero */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success ring-1 ring-success/30">
            <Sparkles className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              CRM Система
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Управление лидами · Воронка продаж · AI-скоринг
            </p>
          </div>
        </div>
        <Button
          onClick={() => setNewOpen(true)}
          className="bg-gradient-primary text-primary-foreground shadow-glow"
        >
          <Plus className="h-4 w-4" />
          Новый лид
        </Button>
      </div>

      {/* KPI */}
      <div className="mt-6">
        <CrmKpiBar kpi={analytics.kpi} />
      </div>

      {/* SLA Alerts */}
      <div className="mt-4">
        <SlaAlerts alerts={analytics.slaAlerts} onJumpToNoAnswer={jumpToNoAnswer} />
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-border/60 bg-card/60 p-1">
          {[
            ...BASE_TABS,
            { id: "automations" as Tab, label: isAdmin ? "Автоматизации" : "Телефония", icon: Zap },
          ].map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors sm:px-4",
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

      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === "funnel" && (
          <div>
            <div className="pb-3">
              <CrmFilters
                state={filters}
                onChange={setFilters}
                sources={sources}
                members={members}
              />
            </div>
            <div className="flex h-[calc(100vh-460px)] min-h-[420px] gap-3 overflow-x-auto pb-3">
              {stages.map((stage, idx) => (
                <div
                  key={stage.id}
                  ref={stage.id === "no_answer" ? noAnswerRef : undefined}
                  className="contents"
                >
                  <StageColumn
                    stage={stage}
                    leads={leadsByStage.get(stage.id) ?? EMPTY_LEADS}
                    metrics={analytics.stageMetrics[idx]}
                    members={members}
                    onDropLead={handleDropLead}
                    onOpenLead={handleOpenLead}
                    onTogglePin={togglePin}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "chats" && (
          <ChatsView
            leads={leads}
            stages={stages}
            chats={chats}
            whatsapp={whatsapp}
            onSend={sendMessage}
            onConnectWhatsApp={() => setWaOpen(true)}
          />
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
          />
        )}

        {tab === "automations" && <AutomationsSettings />}
      </div>

      {/* Dialogs */}
      <NewLeadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        stages={stages}
        onCreate={(input) => {
          addLead(input);
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
        onUpdate={(id, patch) => updateLead(id, patch)}
        onDelete={(id) => {
          removeLead(id);
          toast.success("Лид удалён");
        }}
        onTogglePin={togglePin}
        onAssign={assignLead}
        onSendMessage={(id, text) => sendMessage(id, text)}
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
          setVisit(id, iso);
          toast.success("Визит назначен");
        }}
        onAddTask={addTask}
        onToggleTask={toggleTask}
        onRemoveTask={removeTask}
        onRequestReject={(id) => {
          const current = leads.find((l) => l.id === id);
          setRejectFor({ leadId: id, prevStageId: current?.stageId, viaDrag: false });
        }}
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
            // если закрытие инициировано не через drag — двигаем в стадию «Отказ» сейчас
            if (!rejectFor.viaDrag) moveLead(rejectFor.leadId, "rejected");
            setRejectReason(rejectFor.leadId, reason, note);
            toast.success("Лид закрыт. Причина сохранена в истории.");
          }
          setRejectFor(null);
        }}
      />

      <ConnectWhatsAppDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        current={whatsapp}
        onConnect={(cfg) => {
          setWhatsapp(cfg);
          toast.success("WhatsApp подключён");
        }}
      />
    </main>
  );
};

export default Crm;