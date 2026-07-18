import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { ReportData } from "@/hooks/useReportData";

interface Props {
  data: ReportData | null;
  rangeLabel: string;
}

export function AiChatBar({ data, rangeLabel }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = [
    "Где мы теряем клиентов?",
    "Какие креативы масштабировать?",
    "Почему такой ROMI?",
    "Что сделать на следующей неделе?",
  ];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function askQuestion(question: string) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || !data) return;
    setQ(normalizedQuestion);
    setOpen(true);
    setLoading(true);
    setAnswer("");
    try {
      const { data: resp, error } = await supabase.functions.invoke("report-ai-chat", {
        body: {
          mode: "chat",
          question: normalizedQuestion,
          rangeLabel,
          totals: data.totals,
          prev: data.prev ?? null,
          scoring: data.scoring,
          channels: data.channels.slice(0, 10),
          creatives: data.creatives.slice(0, 10).map((creative) => ({
            name: creative.name,
            spend: creative.spend,
            leads: creative.leads,
            crmSales: creative.crmSales,
            crmRevenue: creative.crmRevenue,
            crmRomi: creative.crmRomi,
          })),
          daily: data.monthlyMeta.slice(-31),
        },
      });
      if (error) throw error;
      setAnswer((resp as { text?: string })?.text ?? "");
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  function ask(e: React.FormEvent) {
    e.preventDefault();
    void askQuestion(q);
  }

  return (
    <>
      <div className="rounded-2xl border border-success/25 bg-success/[0.035] p-3">
        <form onSubmit={ask} className="relative flex-1">
          <Sparkles className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={!data}
            placeholder="Спросите AI-аналитика о рекламе, CRM, продажах или креативах..."
            className="h-12 w-full rounded-xl border border-border/60 bg-background/50 pl-11 pr-24 text-sm outline-none transition-colors focus:border-success/50 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <kbd className="pointer-events-none absolute right-14 top-1/2 hidden -translate-y-1/2 rounded-md border border-border/60 bg-secondary/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">
            ⌘K
          </kbd>
          <button
            type="submit"
            disabled={!q.trim() || !data || loading}
            aria-label="Спросить AI-аналитика"
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg bg-success text-success-foreground transition-opacity disabled:opacity-35"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </form>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={!data || loading}
              onClick={() => void askQuestion(suggestion)}
              className="shrink-0 rounded-full border border-border/50 bg-card/40 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-success/35 hover:text-foreground disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-success" />
              AI Аналитик
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-xl border border-border/40 bg-card/40 p-3 text-sm">
            <span className="text-xs font-semibold text-muted-foreground">Вопрос:</span>
            <div className="mt-1 font-medium">{q}</div>
          </div>
          <div className="min-h-28 whitespace-pre-wrap rounded-xl border border-success/20 bg-success/5 p-4 text-sm leading-relaxed">
            {loading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Думаю...
              </span>
            ) : (
              answer || "—"
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}