import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Send, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

interface Props {
  projectId: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export function StrategyChat({ projectId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadHistory = async () => {
    const { data } = await supabase
      .from("marketing_os_chat_messages")
      .select("id,role,content,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(200);
    setMessages(((data as Message[] | null) ?? []).filter((m) => m.role !== "system"));
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // не подписываемся на realtime во время своего стрима, чтобы не дёргать UI
  useRealtimeTable("marketing_os_chat_messages", () => {
    if (!streaming) loadHistory();
  }, !!projectId);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setStreaming(true);
    setStreamText("");

    // оптимистично показываем пользовательское сообщение
    const optimisticUser: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token ?? SUPABASE_KEY;

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/marketing-os-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          projectId,
          userMessage: text,
          createdBy: session?.session?.user?.id ?? null,
        }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        acc += chunk;
        setStreamText(acc);
      }

      // После завершения стрима — перечитываем БД, там уже есть и user и assistant
      await loadHistory();
      setStreamText("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Чат: ${msg}`);
      // откатываем оптимистичное сообщение
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
    } finally {
      setStreaming(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-border/60 bg-card/40">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-success" />
        Чат со стратегом
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Marketing OS · Claude
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && !streaming && (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            Спроси про стратегию, сегменты, креативы — Claude видит весь контекст проекта (бриф,
            сегменты, готовые артефакты).
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} content={m.content} />
        ))}
        {streaming && streamText && <Bubble role="assistant" content={streamText} live />}
        {streaming && !streamText && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> подключаюсь к Claude…
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-2">
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Например: «добавь сегмент молодых родителей» или «переделай V2 пожёстче»"
            disabled={streaming}
            className="min-h-[44px] resize-none"
          />
          <Button onClick={send} disabled={streaming || !input.trim()} size="icon">
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, content, live }: { role: Message["role"]; content: string; live?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
          <Sparkles className="h-3 w-3" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-success/15 text-foreground"
            : "border border-border/60 bg-background/60",
          live && "border-success/40",
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <article className="prose prose-xs prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        )}
      </div>
      {isUser && (
        <div className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-foreground">
          <User className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
