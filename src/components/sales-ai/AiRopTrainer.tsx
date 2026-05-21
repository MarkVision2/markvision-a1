import { useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  Bot,
  CheckCircle2,
  Flag,
  Loader2,
  MessageSquare,
  Mic,
  Phone,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  getRopSettings,
  getTrainerSessions,
  newId,
  saveTrainerSessions,
  subscribeAiRop,
  TRAINER_SCENARIOS,
  type TrainerMessage,
  type TrainerScenario,
  type TrainerSession,
} from "@/lib/aiRopStorage";
import { useToast } from "@/hooks/use-toast";

const DIFFICULTY_LABEL: Record<TrainerScenario["difficulty"], { label: string; color: string }> = {
  easy: { label: "Лёгкий", color: "text-success" },
  medium: { label: "Средний", color: "text-warning" },
  hard: { label: "Сложный", color: "text-destructive" },
};

const CHANNEL_ICON: Record<TrainerScenario["channel"], typeof Phone> = {
  phone: Phone,
  whatsapp: MessageSquare,
  instagram: MessageSquare,
};

export function AiRopTrainer() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<TrainerSession[]>(getTrainerSessions);
  const [active, setActive] = useState<TrainerSession | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [scoring, setScoring] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length]);

  useEffect(() => {
    setSessions(getTrainerSessions());
    return subscribeAiRop("trainer-sessions", () => setSessions(getTrainerSessions()));
  }, []);

  const persist = (next: TrainerSession[]) => {
    setSessions(next);
    saveTrainerSessions(next);
  };

  const startSession = (scenario: TrainerScenario) => {
    const session: TrainerSession = {
      id: newId("ts"),
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      messages: [
        {
          id: newId("m"),
          role: "ai",
          content: buildOpeningLine(scenario),
          at: new Date().toISOString(),
        },
      ],
      score: null,
      feedback: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    const next = [session, ...sessions];
    persist(next);
    setActive(session);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !active) return;
    const scenario = TRAINER_SCENARIOS.find((s) => s.id === active.scenarioId);
    if (!scenario) return;

    const userMsg: TrainerMessage = {
      id: newId("m"),
      role: "user",
      content: text,
      at: new Date().toISOString(),
    };
    const updated: TrainerSession = {
      ...active,
      messages: [...active.messages, userMsg],
    };
    setActive(updated);
    persistUpdate(updated);
    setInput("");
    setThinking(true);

    try {
      const reply = await askAi(scenario, updated.messages, "reply");
      const aiMsg: TrainerMessage = {
        id: newId("m"),
        role: "ai",
        content: reply,
        at: new Date().toISOString(),
      };
      const next: TrainerSession = { ...updated, messages: [...updated.messages, aiMsg] };
      setActive(next);
      persistUpdate(next);
    } catch (e) {
      toast({
        title: "Ошибка ИИ",
        description: e instanceof Error ? e.message : "Не удалось получить ответ",
        variant: "destructive",
      });
    } finally {
      setThinking(false);
    }
  };

  const persistUpdate = (next: TrainerSession) => {
    const list = sessions.map((s) => (s.id === next.id ? next : s));
    if (!list.find((s) => s.id === next.id)) list.unshift(next);
    persist(list);
  };

  const finishSession = async () => {
    if (!active) return;
    const scenario = TRAINER_SCENARIOS.find((s) => s.id === active.scenarioId);
    if (!scenario) return;
    setScoring(true);
    try {
      const result = await askAi(scenario, active.messages, "score");
      const { score, feedback } = parseScore(result);
      const next: TrainerSession = {
        ...active,
        score,
        feedback,
        finishedAt: new Date().toISOString(),
      };
      setActive(next);
      persistUpdate(next);
      toast({
        title: `Оценка: ${score}/100`,
        description: feedback.slice(0, 100) + (feedback.length > 100 ? "…" : ""),
      });
    } catch (e) {
      toast({
        title: "Не удалось оценить",
        description: e instanceof Error ? e.message : "Ошибка ИИ",
        variant: "destructive",
      });
    } finally {
      setScoring(false);
    }
  };

  const restart = () => {
    setActive(null);
    setInput("");
  };

  if (!active) {
    return <ScenarioPicker sessions={sessions} onStart={startSession} />;
  }

  const scenario = TRAINER_SCENARIOS.find((s) => s.id === active.scenarioId);
  if (!scenario) return null;

  const ChannelIcon = CHANNEL_ICON[scenario.channel];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      {/* Чат */}
      <div className="flex h-[60vh] min-h-0 flex-col rounded-2xl border border-border/60 bg-card/60">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
            <ChannelIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{scenario.title}</div>
            <div className="text-[11px] text-muted-foreground">
              ИИ играет {scenario.role === "patient" ? "пациента" : "лида"} ·{" "}
              {scenario.channel === "phone" ? "телефон" : scenario.channel}
            </div>
          </div>
          <button
            onClick={restart}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Выйти
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {active.messages.map((m) => (
            <Bubble key={m.id} role={m.role} content={m.content} />
          ))}
          {thinking && (
            <Bubble role="ai" content="" thinking />
          )}
          <div ref={endRef} />
        </div>

        {active.score === null ? (
          <div className="border-t border-border/60 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                rows={2}
                placeholder="Напишите ответ администратора…"
                className="flex-1 resize-none rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || thinking}
                className={cn(
                  "inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold",
                  !input.trim() || thinking
                    ? "bg-secondary/60 text-muted-foreground"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Минимум 3-4 реплики, потом — «Завершить и оценить»</span>
              <button
                onClick={finishSession}
                disabled={active.messages.length < 3 || scoring}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold",
                  active.messages.length < 3 || scoring
                    ? "bg-secondary/60 text-muted-foreground"
                    : "bg-success/15 text-success hover:bg-success/25",
                )}
              >
                {scoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flag className="h-3 w-3" />}
                Завершить и оценить
              </button>
            </div>
          </div>
        ) : (
          <ResultBanner score={active.score} feedback={active.feedback ?? ""} onRestart={restart} />
        )}
      </div>

      {/* Сайдбар: контекст и цели */}
      <div className="space-y-3">
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Контекст роли ИИ
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{scenario.context}</p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Target className="h-3.5 w-3.5 text-primary" />
            Цели администратора
          </div>
          <ul className="mt-2 space-y-1.5">
            {scenario.goals.map((g, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Mic className="h-3 w-3" />
            Голосовой режим
          </div>
          <p className="mt-1">
            Подключим ИИ-голос — сможете тренироваться реальным звонком. Сейчас в текстовом режиме.
          </p>
        </div>
      </div>
    </div>
  );
}

function ScenarioPicker({
  sessions,
  onStart,
}: {
  sessions: TrainerSession[];
  onStart: (scenario: TrainerScenario) => void;
}) {
  const recent = sessions.slice(0, 3);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 to-card/40 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-bold">AI Тренажёр для администратора</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ИИ играет пациента или лида, вы — администратора клиники. Цель — записать
              на консультацию или закрыть возражение. После разговора получите оценку и разбор.
            </p>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Сценарии
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {TRAINER_SCENARIOS.map((s) => {
            const Icon = CHANNEL_ICON[s.channel];
            const d = DIFFICULTY_LABEL[s.difficulty];
            return (
              <button
                key={s.id}
                onClick={() => onStart(s)}
                className="group rounded-2xl border border-border/60 bg-card/60 p-4 text-left transition-colors hover:border-primary/50 hover:bg-card/80"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider", d.color)}>
                        {d.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        · {s.channel === "phone" ? "звонок" : s.channel}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-bold">{s.title}</div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{s.context}</p>
                  </div>
                  <Play className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {recent.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Последние тренировки
          </div>
          <div className="space-y-1.5">
            {recent.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-3 text-xs"
              >
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 font-bold tabular-nums",
                    s.score === null
                      ? "bg-secondary/60 text-muted-foreground"
                      : s.score >= 80
                        ? "bg-success/20 text-success"
                        : s.score >= 50
                          ? "bg-warning/20 text-warning"
                          : "bg-destructive/20 text-destructive",
                  )}
                >
                  {s.score === null ? "—" : `${s.score}/100`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{s.scenarioTitle}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(s.startedAt).toLocaleString("ru-RU")} · {s.messages.length} реплик
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({
  role,
  content,
  thinking,
}: {
  role: "user" | "ai";
  content: string;
  thinking?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold",
          isUser ? "bg-primary/20 text-primary" : "bg-secondary/60 text-foreground",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </span>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary/15 text-foreground"
            : "border border-border/60 bg-background/40",
        )}
      >
        {thinking ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">печатает…</span>
          </div>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function ResultBanner({
  score,
  feedback,
  onRestart,
}: {
  score: number;
  feedback: string;
  onRestart: () => void;
}) {
  const tone = score >= 80 ? "success" : score >= 50 ? "warning" : "destructive";
  return (
    <div
      className={cn(
        "border-t p-4",
        tone === "success" && "border-success/40 bg-success/10",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "destructive" && "border-destructive/40 bg-destructive/10",
      )}
    >
      <div className="flex items-center gap-2">
        <Award
          className={cn(
            "h-5 w-5",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
          )}
        />
        <div className="text-lg font-bold tabular-nums">
          Оценка:{" "}
          <span
            className={cn(
              tone === "success" && "text-success",
              tone === "warning" && "text-warning",
              tone === "destructive" && "text-destructive",
            )}
          >
            {score}/100
          </span>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{feedback}</p>
      <button
        onClick={onRestart}
        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Новая тренировка
      </button>
    </div>
  );
}

// ─── Логика общения с ИИ ────────────────────────────────────────────────────

async function askAi(
  scenario: TrainerScenario,
  history: TrainerMessage[],
  mode: "reply" | "score",
): Promise<string> {
  const settings = getRopSettings();

  // Передаём в существующий edge function report-ai-chat в режиме "chat"
  // как универсальный шлюз к LLM, упаковывая инструкции в `question`.
  const systemForAi =
    mode === "reply"
      ? `Ты играешь роль клиента. ${scenario.context}\n\n` +
        `Отвечай по-русски, одним сообщением, как реальный человек: коротко, иногда грубовато, ` +
        `иногда задавай встречные вопросы. Не подыгрывай администратору, поведи реалистично.`
      : `Ты — AI-РОП клиники. Оцени диалог администратора с клиентом по 100-балльной шкале. ` +
        `Цели администратора:\n${scenario.goals.map((g) => "- " + g).join("\n")}\n\n` +
        `Правила РОПа:\n${settings.systemPrompt}\n\n` +
        `Дай ответ строго в формате:\n` +
        `SCORE: <число от 0 до 100>\n` +
        `FEEDBACK: <разбор: что хорошо, что плохо, конкретные рекомендации по фразам — 4-6 предложений>`;

  const dialogText = history
    .map((m) => `${m.role === "user" ? "АДМИНИСТРАТОР" : "КЛИЕНТ"}: ${m.content}`)
    .join("\n");

  const { data, error } = await supabase.functions.invoke("report-ai-chat", {
    body: {
      mode: "question",
      question: `${systemForAi}\n\nДиалог:\n${dialogText}\n\nТвой ответ:`,
      rangeLabel: "тренажёр",
      totals: null,
      prev: null,
      scoring: null,
      channels: [],
    },
  });
  if (error) throw error;
  return (data as { text?: string })?.text ?? "";
}

function parseScore(raw: string): { score: number; feedback: string } {
  const scoreMatch = raw.match(/SCORE:\s*(\d{1,3})/i);
  const feedbackMatch = raw.match(/FEEDBACK:\s*([\s\S]+)/i);
  const score = scoreMatch ? Math.max(0, Math.min(100, Number(scoreMatch[1]))) : 0;
  const feedback = feedbackMatch ? feedbackMatch[1].trim() : raw.trim();
  return { score, feedback };
}

function buildOpeningLine(scenario: TrainerScenario): string {
  if (scenario.channel === "phone") {
    return scenario.role === "patient"
      ? "Алло, здравствуйте? Это вы мне звонили? Я заявку оставлял…"
      : "Алло? Слушаю.";
  }
  // чат
  if (scenario.id === "tr-3") return "Сколько стоит имплант?";
  return scenario.role === "patient"
    ? "Здравствуйте, я по поводу заявки"
    : "Доброго времени";
}
