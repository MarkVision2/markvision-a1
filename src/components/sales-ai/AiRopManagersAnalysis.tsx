import { useEffect, useMemo, useState } from "react";
import {
  Award,
  Brain,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  Sparkles,
  Target,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { ManagerStats } from "@/hooks/useCrmAnalytics";
import { useToast } from "@/hooks/use-toast";
import { AddMemberDialog } from "@/components/settings/AddMemberDialog";

interface Props {
  stats: ManagerStats[];
  projectId: string | null;
}

interface ScoreRow {
  id: string;
  manager_id: string | null;
  overall_score: number | null;
  sla_score: number | null;
  dial_score: number | null;
  conversion_score: number | null;
  calls_avg_score: number | null;
  chats_avg_score: number | null;
  scripts_score: number | null;
  empathy_score: number | null;
  calls_total: number | null;
  chats_total: number | null;
  ai_report: string | null;
  ai_recommendations: string[] | null;
  generated_at: string;
}

export function AiRopManagersAnalysis({ stats, projectId }: Props) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<ManagerStats | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [scoresByManager, setScoresByManager] = useState<Record<string, ScoreRow>>({});

  const loadScores = async () => {
    if (!projectId) {
      setScoresByManager({});
      return;
    }
    const { data, error } = await supabase
      .from("ai_rop_manager_scores")
      .select(
        "id, manager_id, overall_score, sla_score, dial_score, conversion_score, calls_avg_score, chats_avg_score, scripts_score, empathy_score, calls_total, chats_total, ai_report, ai_recommendations, generated_at",
      )
      .eq("project_id", projectId)
      .order("generated_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[AiRopManagersAnalysis] load error", error);
      return;
    }
    const map: Record<string, ScoreRow> = {};
    for (const r of (data ?? []) as ScoreRow[]) {
      if (!r.manager_id) continue;
      if (!map[r.manager_id]) map[r.manager_id] = r; // первая = самая свежая
    }
    setScoresByManager(map);
  };

  useEffect(() => {
    void loadScores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const runAnalysis = async (m: ManagerStats) => {
    if (!projectId) {
      toast({ title: "Нет проекта", description: "Выберите проект", variant: "destructive" });
      return;
    }
    setAnalyzing(m.member.id);
    try {
      const { error } = await supabase.functions.invoke("ai-rop-score-manager", {
        body: { project_id: projectId, manager_id: m.member.id, generate_report: true },
      });
      if (error) throw error;
      await loadScores();
      toast({ title: "Анализ готов", description: m.member.name });
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "Не удалось получить анализ",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(null);
    }
  };

  const sorted = useMemo(
    () =>
      [...stats].sort((a, b) => {
        const sa = scoresByManager[a.member.id]?.overall_score ?? computeFallback(a);
        const sb = scoresByManager[b.member.id]?.overall_score ?? computeFallback(b);
        return sb - sa;
      }),
    [stats, scoresByManager],
  );

  if (sorted.length === 0) {
    return (
      <>
        <div className="rounded-2xl border border-border/60 bg-card/60 p-10 text-center">
          <User className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <div className="mt-3 text-base font-semibold">Нет менеджеров</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Добавьте сотрудников с ролью «Менеджер», чтобы РОП мог их оценивать.
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" />
            Добавить менеджера
          </button>
        </div>
        <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Brain className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <h3 className="text-sm font-bold">AI-оценка менеджеров</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              РОП считает интегральный балл: SLA, дозвон, конверсия, звонки, чаты, скрипты, эмпатия.
              Балл пересчитывается ежедневно или по кнопке «Глубокий анализ».
            </p>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Добавить
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sorted.map((m) => {
          const score = scoresByManager[m.member.id];
          const aiScore = score?.overall_score ?? computeFallback(m);
          const tone = aiScore >= 75 ? "success" : aiScore >= 50 ? "warning" : "destructive";
          const slaPct =
            m.respondedTotal > 0 ? (m.responsesUnder5 / m.respondedTotal) * 100 : 0;
          return (
            <div key={m.member.id} className="rounded-2xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary/60 text-foreground">
                  <User className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate text-sm font-bold">{m.member.name}</h4>
                    {aiScore >= 80 && <Award className="h-3.5 w-3.5 text-warning" />}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {score
                      ? `Обновлено ${new Date(score.generated_at).toLocaleString("ru-RU")}`
                      : "Балл предварительный — нажмите «Глубокий анализ»"}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      "text-2xl font-bold tabular-nums",
                      tone === "success" && "text-success",
                      tone === "warning" && "text-warning",
                      tone === "destructive" && "text-destructive",
                    )}
                  >
                    {aiScore}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    балл
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2">
                <MiniMetric icon={Clock} label="SLA <5м" value={`${slaPct.toFixed(0)}%`} />
                <MiniMetric icon={Phone} label="Лиды" value={String(m.assigned)} />
                <MiniMetric icon={Target} label="CR" value={`${m.conversion.toFixed(0)}%`} />
                <MiniMetric
                  icon={MessageSquare}
                  label="Звонков"
                  value={String(score?.calls_total ?? 0)}
                />
              </div>

              {score?.ai_report ? (
                <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-primary">
                    <Sparkles className="h-3 w-3" />
                    Анализ ИИ-РОПа
                  </div>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                    {score.ai_report}
                  </p>
                  {score.ai_recommendations && score.ai_recommendations.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                      {score.ai_recommendations.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                  <button
                    onClick={() => runAnalysis(m)}
                    disabled={analyzing === m.member.id}
                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline disabled:opacity-50"
                  >
                    {analyzing === m.member.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Brain className="h-3 w-3" />
                    )}
                    Пересчитать
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => runAnalysis(m)}
                    disabled={analyzing === m.member.id}
                    className={cn(
                      "inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold",
                      analyzing === m.member.id
                        ? "bg-secondary/60 text-muted-foreground"
                        : "bg-primary/15 text-primary hover:bg-primary/25",
                    )}
                  >
                    {analyzing === m.member.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Brain className="h-3.5 w-3.5" />
                    )}
                    Глубокий анализ
                  </button>
                  <button
                    onClick={() => setSelected(m)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  >
                    Детали
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <ManagerDetailPanel
          stats={selected}
          score={scoresByManager[selected.member.id]}
          onClose={() => setSelected(null)}
        />
      )}
      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-2 text-center">
      <Icon className="mx-auto h-3 w-3 text-muted-foreground" />
      <div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function ManagerDetailPanel({
  stats,
  score,
  onClose,
}: {
  stats: ManagerStats;
  score?: ScoreRow;
  onClose: () => void;
}) {
  const aiScore = score?.overall_score ?? computeFallback(stats);
  const slaPct =
    stats.respondedTotal > 0 ? (stats.responsesUnder5 / stats.respondedTotal) * 100 : 0;

  const breakdown = [
    {
      label: "SLA первого ответа",
      score: score?.sla_score ?? slaPct,
      target: 70,
      hint: `${stats.responsesUnder5} из ${stats.respondedTotal} ответили за <5 мин`,
    },
    {
      label: "Дозвон",
      score: score?.dial_score ?? 0,
      target: 60,
      hint: `${stats.respondedTotal} из ${stats.assigned} лидов ответили`,
      pending: !score,
    },
    {
      label: "Конверсия в оплату",
      score: Math.min(100, stats.conversion * 4),
      target: 60,
      hint: `${stats.paid} оплат из ${stats.assigned} лидов`,
    },
    {
      label: "Звонки (ср. оценка)",
      score: score?.calls_avg_score ?? 0,
      target: 70,
      hint: `${score?.calls_total ?? 0} звонков разобрано`,
      pending: !score || (score.calls_total ?? 0) === 0,
    },
    {
      label: "Чаты (ср. оценка)",
      score: score?.chats_avg_score ?? 0,
      target: 70,
      hint: `${score?.chats_total ?? 0} чатов разобрано`,
      pending: !score || (score.chats_total ?? 0) === 0,
    },
    {
      label: "Скрипты",
      score: score?.scripts_score ?? 0,
      target: 70,
      hint: "Соблюдение скриптов в звонках",
      pending: !score || (score.scripts_score ?? 0) === 0,
    },
    {
      label: "Эмпатия и тон",
      score: score?.empathy_score ?? 0,
      target: 70,
      hint: "Из критериев AI-разборов",
      pending: !score || (score.empathy_score ?? 0) === 0,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary/60">
              <User className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold">{stats.member.name}</h3>
              <div className="text-[11px] text-muted-foreground">
                {score
                  ? `Обновлено ${new Date(score.generated_at).toLocaleString("ru-RU")}`
                  : "Балл предварительный"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-3xl font-bold tabular-nums">{aiScore}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">балл</div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {breakdown.map((b, i) => {
            const pct = Math.min(100, b.score);
            const tone = b.pending
              ? "muted"
              : b.score >= b.target
                ? "success"
                : b.score >= b.target * 0.6
                  ? "warning"
                  : "destructive";
            return (
              <div key={i} className="rounded-lg border border-border/40 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{b.label}</span>
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                      tone === "success" && "bg-success/15 text-success",
                      tone === "warning" && "bg-warning/15 text-warning",
                      tone === "destructive" && "bg-destructive/15 text-destructive",
                      tone === "muted" && "bg-secondary/60 text-muted-foreground",
                    )}
                  >
                    {b.pending ? "ждём данных" : `${pct.toFixed(0)}%`}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">{b.hint}</div>
                {!b.pending && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary/60">
                    <div
                      className={cn(
                        "h-full",
                        tone === "success" && "bg-success",
                        tone === "warning" && "bg-warning",
                        tone === "destructive" && "bg-destructive",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {score?.ai_report && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-primary">
              <Sparkles className="h-3 w-3" />
              Анализ ИИ-РОПа
            </div>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
              {score.ai_report}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function computeFallback(s: ManagerStats): number {
  const slaPct = s.respondedTotal > 0 ? (s.responsesUnder5 / s.respondedTotal) * 100 : 0;
  const slaScore = Math.min(100, slaPct);
  const convScore = Math.min(100, s.conversion * 4);
  return Math.round(slaScore * 0.4 + convScore * 0.6);
}
