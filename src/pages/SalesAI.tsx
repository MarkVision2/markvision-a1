import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Bot,
  CheckCircle2,
  Clock,
  GraduationCap,
  Headphones,
  Lightbulb,
  MessageSquare,
  Phone,
  Settings as SettingsIcon,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCrmStore } from "@/hooks/useCrmStore";
import { useTeamStore } from "@/hooks/useTeamStore";
import { useCrmAnalytics } from "@/hooks/useCrmAnalytics";
const AiRopCallsAnalysis = lazy(() => import("@/components/sales-ai/AiRopCallsAnalysis").then((m) => ({ default: m.AiRopCallsAnalysis })));
const AiRopChatsAnalysis = lazy(() => import("@/components/sales-ai/AiRopChatsAnalysis").then((m) => ({ default: m.AiRopChatsAnalysis })));
const AiRopManagersAnalysis = lazy(() => import("@/components/sales-ai/AiRopManagersAnalysis").then((m) => ({ default: m.AiRopManagersAnalysis })));
const AiRopTrainer = lazy(() => import("@/components/sales-ai/AiRopTrainer").then((m) => ({ default: m.AiRopTrainer })));
const AiRopScripts = lazy(() => import("@/components/sales-ai/AiRopScripts").then((m) => ({ default: m.AiRopScripts })));
const AiRopContentPlan = lazy(() => import("@/components/sales-ai/AiRopContentPlan").then((m) => ({ default: m.AiRopContentPlan })));
import { AiRopSettings } from "@/components/sales-ai/AiRopSettings";
import { AiRopCommandCenter } from "@/components/sales-ai/AiRopCommandCenter";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useAuth } from "@/hooks/useAuth";
import { hydrateAiRopStorage } from "@/lib/aiRopStorage";

type TabId =
  | "overview"
  | "calls"
  | "chats"
  | "managers"
  | "trainer"
  | "scripts"
  | "content"
  | "insights"
  | "settings";

const TABS: { id: TabId; label: string; icon: typeof Phone }[] = [
  { id: "overview", label: "Обзор", icon: Sparkles },
  { id: "calls", label: "Звонки", icon: Phone },
  { id: "chats", label: "Чаты", icon: MessageSquare },
  { id: "managers", label: "Менеджеры", icon: Users },
  { id: "trainer", label: "Тренажёр", icon: GraduationCap },
  { id: "scripts", label: "Скрипты", icon: BookOpen },
  { id: "content", label: "Контент-план", icon: Lightbulb },
  { id: "insights", label: "Инсайты ИИ", icon: Bot },
  { id: "settings", label: "Настройки", icon: SettingsIcon },
];

const SectionCard = ({
  title,
  hint,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  hint?: string;
  icon: typeof Phone;
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold tracking-tight">{title}</h2>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
    <div className="mt-3">{children}</div>
  </div>
);

const SalesAI = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { leads, stages } = useCrmStore();
  const { members } = useTeamStore();
  const analytics = useCrmAnalytics(leads, stages, members);
  const { activeId } = useProjectsStore();
  const { user } = useAuth();

  useEffect(() => {
    void hydrateAiRopStorage(activeId ?? null, user?.id ?? null);
  }, [activeId, user?.id]);

  const initialTab = (searchParams.get("tab") as TabId) || "overview";
  const validTab = TABS.find((t) => t.id === initialTab) ? initialTab : "overview";
  const [tab, setTab] = useState<TabId>(validTab);

  useEffect(() => {
    const qp = searchParams.get("tab") as TabId | null;
    if (qp && qp !== tab && TABS.find((t) => t.id === qp)) {
      setTab(qp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const switchTab = (id: TabId) => {
    setTab(id);
    const next = new URLSearchParams(searchParams);
    if (id === "overview") next.delete("tab");
    else next.set("tab", id);
    setSearchParams(next, { replace: true });
  };

  const totalLeads = leads.length;
  const slaAlerts = analytics.slaAlerts;

  const managerLeaderboard = useMemo(
    () => [...analytics.managerStats].sort((a, b) => b.paid - a.paid).slice(0, 5),
    [analytics.managerStats],
  );

  // Heuristic AI insights from live data — replaced with real LLM calls later.
  const insights = useMemo(() => {
    const items: { tone: "warning" | "success" | "destructive"; title: string; body: string }[] = [];
    if (analytics.kpi.avgResponseMin > 5) {
      items.push({
        tone: analytics.kpi.avgResponseMin > 15 ? "destructive" : "warning",
        title: `Среднее время ответа ${analytics.kpi.avgResponseMin} мин`,
        body: "Норма — до 5 мин. Каждая лишняя минута снижает конверсию в запись ~7%. Назначьте дежурного на «Без ответа».",
      });
    }
    if (analytics.kpi.rejectedPct > 30) {
      items.push({
        tone: "destructive",
        title: `Высокая потеря ${analytics.kpi.rejectedPct.toFixed(0)}%`,
        body: `Основная причина: ${analytics.kpi.topRejectReason?.label ?? "—"}. Проверьте скрипты по этому возражению.`,
      });
    }
    if (slaAlerts.red.length > 0) {
      items.push({
        tone: "destructive",
        title: `${slaAlerts.red.length} лидов горят > 15 мин`,
        body: "Открыть CRM → «Без ответа» и реанимировать в первую очередь.",
      });
    }
    if (analytics.kpi.paidPct > 0 && items.length === 0) {
      items.push({
        tone: "success",
        title: "SLA в норме",
        body: `Конверсия в продажу ${analytics.kpi.paidPct.toFixed(0)}%, средний ответ ${analytics.kpi.avgResponseMin} мин. Так держать.`,
      });
    }
    if (items.length === 0) {
      items.push({
        tone: "success",
        title: "Пока нечего флагать",
        body: "Подключите телефонию и WhatsApp, чтобы ИИ начал анализировать качество разговоров и переписки.",
      });
    }
    return items;
  }, [analytics, slaAlerts]);

  return (
    <main className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col animate-fade-in-up">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Bot className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold sm:text-xl">AI РОП</h1>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Beta
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                ИИ-руководитель отдела продаж · следит за лидами, звонками, чатами и менеджерами
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {totalLeads} лидов в работе
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto mt-3 flex max-w-[1400px] gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
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

      {/* Content */}
      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-[1400px] space-y-4">
          {tab === "overview" && (
            <>
              <AiRopCommandCenter
                leads={leads}
                managerStats={analytics.managerStats}
                paidPct={analytics.kpi.paidPct}
                rejectedPct={analytics.kpi.rejectedPct}
                avgResponseMin={analytics.kpi.avgResponseMin}
                onOpenLead={(leadId) => navigate(`/crm?lead=${leadId}`)}
                onOpenTab={switchTab}
              />

              {/* Manager leaderboard */}
              <SectionCard
                title="Лидерборд менеджеров"
                hint="По количеству закрытых сделок"
                icon={BadgeCheck}
              >
                {managerLeaderboard.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground">
                    Пока нет назначенных менеджеров. Назначьте ответственных в CRM.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="pb-2 font-medium">Менеджер</th>
                          <th className="pb-2 font-medium">Лиды</th>
                          <th className="pb-2 font-medium">Оплаты</th>
                          <th className="pb-2 font-medium">CR в оплату</th>
                          <th className="pb-2 font-medium">Ответ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managerLeaderboard.map((m, idx) => (
                          <tr key={m.member.id} className="border-t border-border/40">
                            <td className="py-2 font-semibold">
                              <span className="mr-1 inline-block w-5 text-muted-foreground">{idx + 1}.</span>
                              {m.member.name}
                            </td>
                            <td className="py-2 tabular-nums">{m.assigned}</td>
                            <td className="py-2 tabular-nums text-success">{m.paid}</td>
                            <td className="py-2 tabular-nums">{m.assigned ? `${m.conversion.toFixed(0)}%` : "—"}</td>
                            <td className="py-2 tabular-nums">{m.respondedTotal > 0 ? `${m.responsesUnder5}/${m.respondedTotal}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {tab === "calls" && (
            <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Загрузка…</div>}>
              <AiRopCallsAnalysis leads={leads} projectId={activeId ?? null} />
            </Suspense>
          )}

          {tab === "chats" && (
            <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Загрузка…</div>}>
              <AiRopChatsAnalysis leads={leads} projectId={activeId ?? null} />
            </Suspense>
          )}

          {tab === "managers" && (
            <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Загрузка…</div>}>
              <AiRopManagersAnalysis stats={analytics.managerStats} projectId={activeId ?? null} />
            </Suspense>
          )}

          {tab === "trainer" && (
            <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Загрузка…</div>}>
              <AiRopTrainer />
            </Suspense>
          )}

          {tab === "scripts" && (
            <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Загрузка…</div>}>
              <AiRopScripts projectId={activeId ?? null} />
            </Suspense>
          )}

          {tab === "content" && (
            <Suspense fallback={<div className="py-12 text-center text-sm text-muted-foreground">Загрузка…</div>}>
              <AiRopContentPlan projectId={activeId ?? null} />
            </Suspense>
          )}

          {tab === "settings" && <AiRopSettings />}

          {tab === "insights" && (
            <SectionCard
              title="ИИ-инсайты по продажам"
              hint="Что мешает продавать больше прямо сейчас"
              icon={Sparkles}
            >
              <div className="space-y-2">
                {insights.map((it, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "rounded-xl border p-3 text-sm",
                      it.tone === "destructive" && "border-destructive/40 bg-destructive/10",
                      it.tone === "warning" && "border-warning/40 bg-warning/10",
                      it.tone === "success" && "border-success/40 bg-success/10",
                    )}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {it.tone === "destructive" ? <AlertTriangle className="h-4 w-4 text-destructive" /> : it.tone === "warning" ? <Clock className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                      {it.title}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{it.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 p-3 text-[11px] text-muted-foreground">
                <Headphones className="h-3.5 w-3.5 shrink-0 text-primary" />
                Подключите телефонию и WhatsApp в «Подключения», чтобы ИИ начал слушать звонки и читать чаты для более глубоких инсайтов.
              </div>
            </SectionCard>
          )}
        </div>
      </section>
    </main>
  );
};

export default SalesAI;
