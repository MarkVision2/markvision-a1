import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, Send, Sparkles, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CHANNEL_META, type AiAgent } from "@/lib/aiAgentsStore";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agent: AiAgent | null;
}

type ChatMessage = { id: string; role: "client" | "agent"; text: string };

const QUICK_PROMPTS = [
  "Сколько это стоит?",
  "А где вы находитесь?",
  "Можно записаться на завтра?",
  "Чем вы лучше конкурентов?",
];

function buildSystemPrompt(agent: AiAgent): string {
  const knowledge = agent.knowledge
    .filter((k) => k.question.trim() && k.answer.trim())
    .map((k) => `В: ${k.question}\nО: ${k.answer}`)
    .join("\n\n");

  return [
    agent.systemPrompt.trim(),
    knowledge ? `База знаний (используй для точных ответов):\n${knowledge}` : "",
    `Ты отвечаешь клиенту в ${CHANNEL_META[agent.channel].label}. Пиши по-русски, ` +
      `одним коротким сообщением, в живом дружелюбном тоне, как реальный администратор. ` +
      `Не выдумывай фактов, которых нет в инструкциях или базе знаний. ` +
      `Если не знаешь ответа — ответь так: «${agent.fallback.trim()}».`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function AiAgentTestDialog({ open, onOpenChange, agent }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // При открытии — стартуем диалог приветствием агента.
  useEffect(() => {
    if (open && agent) {
      setMessages(
        agent.greeting.trim()
          ? [{ id: "greeting", role: "agent", text: agent.greeting.trim() }]
          : [],
      );
      setInput("");
    }
  }, [open, agent]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  if (!agent) return null;

  const send = async (textRaw: string) => {
    const text = textRaw.trim();
    if (!text || loading) return;

    const clientMsg: ChatMessage = { id: `c-${Date.now()}`, role: "client", text };
    const history = [...messages, clientMsg];
    setMessages(history);
    setInput("");
    setLoading(true);

    try {
      const dialog = history
        .map((m) => `${m.role === "client" ? "КЛИЕНТ" : "АГЕНТ"}: ${m.text}`)
        .join("\n");
      const question = `${buildSystemPrompt(agent)}\n\nДиалог:\n${dialog}\n\nАГЕНТ:`;

      const { data, error } = await supabase.functions.invoke("report-ai-chat", {
        body: {
          mode: "question",
          question,
          rangeLabel: "тест ИИ-агента",
          totals: null,
          prev: null,
          scoring: null,
          channels: [],
        },
      });
      if (error) throw error;
      const reply = (data as { text?: string })?.text?.trim();
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "agent",
          text: reply || agent.fallback.trim() || "…",
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Не удалось получить ответ ИИ";
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        { id: `e-${Date.now()}`, role: "agent", text: `⚠️ ${msg}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[680px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b border-border/60 bg-card/60 px-4 py-3">
          <DialogTitle className="flex items-center gap-2.5 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{agent.name || "ИИ-агент"}</div>
              <div className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                <MessageCircle className="h-3 w-3" />
                {CHANNEL_META[agent.channel].label} · тест ответов
              </div>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Тестовый диалог с ИИ-агентом
          </DialogDescription>
        </DialogHeader>

        {/* Лента сообщений */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-secondary/20 px-4 py-4">
          <div className="mx-auto flex max-w-[90%] items-center justify-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-center text-[10px] text-primary">
            <Sparkles className="h-3 w-3" />
            Ответы генерирует настоящий ИИ по промту агента
          </div>
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex items-end gap-2", m.role === "client" ? "flex-row-reverse" : "flex-row")}
            >
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                  m.role === "client" ? "bg-secondary text-foreground" : "bg-primary/15 text-primary",
                )}
              >
                {m.role === "client" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </span>
              <div
                className={cn(
                  "max-w-[78%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  m.role === "client"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm border border-border/60 bg-card",
                )}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-end gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                <Bot className="h-3.5 w-3.5" />
              </span>
              <div className="rounded-2xl rounded-bl-sm border border-border/60 bg-card px-3 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Быстрые вопросы */}
        {messages.length <= 1 && !loading && (
          <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-4 pt-3">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Поле ввода */}
        <div className="flex items-center gap-2 border-t border-border/60 bg-background/80 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Напишите как клиент…"
            disabled={loading}
            className="flex-1 rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50 disabled:opacity-60"
          />
          <button
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            aria-label="Отправить"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
