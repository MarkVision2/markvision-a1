import { useMemo, useState } from "react";
import {
  Award,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { ManagerStats } from "@/hooks/useCrmAnalytics";
import { getRopSettings } from "@/lib/aiRopStorage";
import { useToast } from "@/hooks/use-toast";

interface Props {
  stats: ManagerStats[];
}

export function AiRopManagersAnalysis({ stats }: Props) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<ManagerStats | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});

  const sorted = useMemo(
    () => [...stats].sort((a, b) => computeAiScore(b) - computeAiScore(a)),
    [stats],
  );

  const runAnalysis = async (m: ManagerStats) => {
    setAnalyzing(m.member.id);
    try {
      const report = await analyzeManager(m);
      setReports({ ...reports, [m.member.id]: report });
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

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-10 text-center">
        <User className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <div className="mt-3 text-base font-semibold">Нет менеджеров</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Назначьте сотрудников с ролью «Менеджер» в разделе Команда, чтобы РОП
          мог их оценивать.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Brain className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold">AI-оценка менеджеров</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              РОП считает интегральный балл по 5 направлениям: SLA, дозвон, конверсия, потери,
              соблюдение скриптов. Нажмите «Глубокий анализ» — получите персональные
              рекомендации и план обучения.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sorted.map((m) => {
          const aiScore = computeAiScore(m);
          const tone = aiScore >= 75 ? "success" : aiScore >= 50 ? "warning" : "destructive";
          const slaPct = m.respondedTotal > 0 ? (m.responsesUnder5 / m.respondedTotal) * 100 : 0;
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
                  <div className="truncate text-[10px] text-muted-foreground">{m.member.email}</div>
                </div>
                <div className="text-right">
                  <div className={cn("text-2xl font-bold tabular-nums", `text-${tone}`)}>
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
                <MiniMetric
                  icon={Target}
                  label="CR"
                  value={`${m.conversion.toFixed(0)}%`}
                />
                <MiniMetric
                  icon={MessageSquare}
                  label="Оплаты"
                  value={String(m.paid)}
                />
              </div>

              {reports[m.member.id] ? (
                <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-primary">
                    <Sparkles className="h-3 w-3" />
                    Анализ ИИ-РОПа
                  </div>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                    {reports[m.member.id]}
                  </p>
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

      {selected && <ManagerDetailPanel stats={selected} onClose={() => setSelected(null)} />}
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
  onClose,
}: {
  stats: ManagerStats;
  onClose: () => void;
}) {
  const aiScore = computeAiScore(stats);
  const slaPct = stats.respondedTotal > 0 ? (stats.responsesUnder5 / stats.respondedTotal) * 100 : 0;

  const breakdown = [
    {
      label: "SLA первого ответа",
      score: slaPct,
      target: 70,
      hint: `${stats.responsesUnder5} из ${stats.respondedTotal} ответили за <5 мин`,
    },
    {
      label: "Конверсия в оплату",
      score: stats.conversion,
      target: 15,
      hint: `${stats.paid} оплат из ${stats.assigned} лидов`,
    },
    {
      label: "Скрипты и эмпатия",
      score: 0,
      target: 70,
      hint: "Будет считаться после подключения анализа звонков/чатов",
      pending: true,
    },
    {
      label: "Скорость закрытия",
      score: 0,
      target: 60,
      hint: "Среднее время лид → оплата",
      pending: true,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur">
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary/60">
              <User className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold">{stats.member.name}</h3>
              <div className="text-[11px] text-muted-foreground">{stats.member.email}</div>
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

        <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
          После подключения телефонии и WhatsApp РОП дополнит карточку: соблюдение скриптов,
          оценка тона, типичные ошибки, индивидуальный план обучения.
        </div>
      </div>
    </div>
  );
}

function computeAiScore(s: ManagerStats): number {
  const slaPct = s.respondedTotal > 0 ? (s.responsesUnder5 / s.respondedTotal) * 100 : 0;
  const slaScore = Math.min(100, slaPct);
  const convScore = Math.min(100, s.conversion * 4); // 25% → 100 баллов
  // среднее с весами: SLA 40%, конверсия 60%
  return Math.round(slaScore * 0.4 + convScore * 0.6);
}

async function analyzeManager(m: ManagerStats): Promise<string> {
  const settings = getRopSettings();
  const slaPct = m.respondedTotal > 0 ? (m.responsesUnder5 / m.respondedTotal) * 100 : 0;

  const prompt =
    `${settings.systemPrompt}\n\n` +
    `Проанализируй менеджера по данным CRM и дай разбор на 4-5 предложений по-русски.\n\n` +
    `Менеджер: ${m.member.name}\n` +
    `Назначено лидов: ${m.assigned}\n` +
    `Оплат: ${m.paid}\n` +
    `Конверсия в оплату: ${m.conversion.toFixed(1)}%\n` +
    `Выручка: ${m.revenue} $\n` +
    `Ответил за <5 мин: ${m.responsesUnder5} из ${m.respondedTotal} (${slaPct.toFixed(0)}%)\n\n` +
    `Цели: дозвон >${settings.kpi.minDialPct}%, конверсия >${settings.kpi.minConversionPct}%, ` +
    `потери <${settings.kpi.maxRejectPct}%.\n` +
    `Тон: ${settings.tone}.\n\n` +
    `Дай: сильные стороны, что просесть, конкретные 2-3 рекомендации.`;

  const { data, error } = await supabase.functions.invoke("report-ai-chat", {
    body: {
      mode: "question",
      question: prompt,
      rangeLabel: "анализ менеджера",
      totals: null,
      prev: null,
      scoring: null,
      channels: [],
    },
  });
  if (error) throw error;
  return (data as { text?: string })?.text ?? "Нет ответа";
}
